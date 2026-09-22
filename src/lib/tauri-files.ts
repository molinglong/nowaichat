'use client'

import { getIsTauri } from './tauri'

/**
 * AI 本地文件能力的前端执行桥(Tauri)。
 *
 * 职责:把 local_file 工具调用翻译成对 Rust 命令(lf_*)的 invoke,并统一结果形状。
 * 关键约束——远程壳架构下,只有桌面客户端(Tauri WebView)能碰本地磁盘;网页端
 * (chat.yuban.icu 直接访问)全部 no-op,返回 { ok:false, error:'仅桌面客户端可用' },
 * 让模型如实告知用户"该能力仅桌面端可用",绝不臆造成功。
 *
 * 安全:前端只传"相对工作区路径",唯一授权根由 Rust 侧配置持有;越界/系统目录由
 * Rust safe_join 二次拦截。文本内容在前端统一 UTF-8 → base64 后交给 lf_write_file。
 */

/** 统一结果形状:与 LocalFileToolOutput 对齐,可直接 addToolOutput 回填给模型。 */
export interface LocalFileOpResult {
  ok: boolean
  /** 实际落盘/删除的绝对路径(成功时) */
  absPath?: string
  /** create 成功时写入的字节数;read 时为文件真实大小 */
  bytes?: number
  /** delete 成功=true 表示已移入回收站 */
  trashed?: boolean
  /** 失败/被拒原因 */
  error?: string
  /** read 成功时返回的文本内容(Rust 侧超 64KB 截断) */
  content?: string
  /** read/list 结果被截断 */
  truncated?: boolean
  /** list 成功时的目录条目(单层) */
  entries?: { name: string; kind: 'dir' | 'file'; size: number }[]
  /** write(覆盖/新建)/edit 成功时的撤销记录 id,供卡片一键恢复操作前内容 */
  undoId?: string
  /** exec 的进程退出码(0=成功;-1 表示超时被强杀) */
  exitCode?: number
  /** exec 的合并输出(stdout+stderr,UTF-8,超 8KB 截断) */
  execOutput?: string
  /** exec 耗时毫秒 */
  durationMs?: number
  /** overview/search 的紧凑文本输出(目录树 / path:行号:内容 命中列表) */
  text?: string
  /** search 命中条数 */
  hits?: number
  /** search 实际扫描的文件数 */
  scannedFiles?: number
  /** overview 统计:文件/目录总数 */
  totalFiles?: number
  totalDirs?: number
  /** read:文件总行数(配合 nextOffset 续读) */
  totalLines?: number
  /** read:还有后续内容时,下次 read 的 offset */
  nextOffset?: number
}

/** 选择工作区目录的结果(区分"用户取消"与"设置失败") */
export interface PickWorkspaceResult {
  ok: boolean
  /** 成功授权的工作区根(绝对路径) */
  base?: string
  /** 用户在选择器里点了取消 */
  cancelled?: boolean
  error?: string
}

/**
 * 本地文件开关的跨窗口同步键:设置窗口(独立 WebView)切换开关后写入时间戳,
 * 主窗口经 storage 事件(同源跨窗口广播,写窗口自身不触发)感知并立即 refetch,
 * 让开关秒级生效——不依赖 refetchOnWindowFocus(会被 staleTime 拦下)。
 */
export const LOCAL_FILES_SYNC_KEY = 'aichatt:local-files-sync'

const WEB_ONLY: LocalFileOpResult = { ok: false, error: '仅桌面客户端可用' }

/** 仅在 Tauri 内调用;非 Tauri 环境不应走到这里(调用方已用 getIsTauri 拦掉)。 */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(cmd, args)
}

/**
 * UTF-8 文本 → base64。分块处理避免大文件把 String.fromCharCode 的调用栈撑爆。
 * (Tauri WebView 提供 btoa/TextEncoder;此处不依赖 Node Buffer。)
 */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  const CHUNK = 0x2000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK)
    // 用索引访问拷进普通 number[](而非展开 Uint8Array),避免 downlevelIteration 要求
    const codes: number[] = new Array(slice.length)
    for (let j = 0; j < slice.length; j++) codes[j] = slice[j]
    bin += String.fromCharCode(...codes)
  }
  return btoa(bin)
}

/** base64 → UTF-8 文本。与 utf8ToBase64 互逆,read 结果解码用。 */
function base64ToUtf8(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * 弹出系统目录选择器,用户选定后写入 Rust 侧配置作为唯一授权工作区根。
 * 网页端 / 用户取消 / 设置失败 都返回 ok:false(附原因供 UI 提示)。
 */
export async function pickWorkspaceDir(): Promise<PickWorkspaceResult> {
  if (!getIsTauri()) return { ok: false, error: '仅桌面客户端可用' }
  let picked: string | null = null
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const res = await open({
      directory: true,
      multiple: false,
      title: '选择 AI 可操作的工作区文件夹',
    })
    picked = typeof res === 'string' && res ? res : null
  } catch (err) {
    return { ok: false, error: `打开目录选择器失败: ${String(err)}` }
  }
  if (!picked) return { ok: false, cancelled: true }
  try {
    await invoke('lf_set_base', { absPath: picked })
    return { ok: true, base: picked }
  } catch (err) {
    // Rust 侧校验失败(非目录 / 系统目录 / 不可写)会以字符串 reject
    return { ok: false, error: String(err) }
  }
}

/** 读回当前授权工作区根(绝对路径);未授权 / 网页端返回 null。 */
export async function getWorkspaceDir(): Promise<string | null> {
  if (!getIsTauri()) return null
  try {
    return await invoke<string | null>('lf_get_base')
  } catch (err) {
    console.error('[tauri-files] getWorkspaceDir failed:', err)
    return null
  }
}

/**
 * 在工作区内生成/覆盖写入文本文件。
 * @param relPath 相对工作区根的路径(如 notes/todo.md)
 * @param text    UTF-8 纯文本内容(前端负责 base64 编码)
 */
export async function writeFile(relPath: string, text: string): Promise<LocalFileOpResult> {
  if (!getIsTauri()) return WEB_ONLY
  try {
    const contentBase64 = utf8ToBase64(text)
    const r = await invoke<{ absPath: string; bytes: number; undoId: string | null }>('lf_write_file', {
      relPath,
      contentBase64,
    })
    return { ok: true, absPath: r.absPath, bytes: r.bytes, undoId: r.undoId ?? undefined }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * 把工作区内一个文件移入系统回收站(可还原)。
 * 调用方(UI)负责在执行前取得用户确认;本函数只负责执行。
 * @param relPath 相对工作区根的路径
 */
export async function deleteFile(relPath: string): Promise<LocalFileOpResult> {
  if (!getIsTauri()) return WEB_ONLY
  try {
    const r = await invoke<{ absPath: string; trashed: boolean }>('lf_delete_file', { relPath })
    return { ok: true, absPath: r.absPath, trashed: r.trashed }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * 读取工作区内一个 UTF-8 文本文件(二进制/非 UTF-8 会被 Rust 侧拒绝,单次输出超 64KB 截断)。
 * offset/limit 可选行范围读取(1-based,limit 上限 800);mode="outline" 只返回结构骨架。
 * 结果带 totalLines;还有后续内容时带 nextOffset,调用方据此续读。
 * 读操作不落盘无破坏性,无需用户确认。
 * @param relPath 相对工作区根的路径
 */
export async function readFile(
  relPath: string,
  offset?: number,
  limit?: number,
  mode?: "full" | "outline"
): Promise<LocalFileOpResult> {
  if (!getIsTauri()) return WEB_ONLY
  try {
    const r = await invoke<{
      absPath: string
      bytes: number
      contentBase64: string
      truncated: boolean
      totalLines: number
      nextOffset: number | null
    }>('lf_read_file', {
      relPath,
      offset: offset ?? null,
      limit: limit ?? null,
      mode: mode ?? null,
    })
    return {
      ok: true,
      absPath: r.absPath,
      bytes: r.bytes,
      content: base64ToUtf8(r.contentBase64),
      truncated: r.truncated,
      totalLines: r.totalLines,
      nextOffset: r.nextOffset ?? undefined,
    }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * 列出工作区内一个目录的单层内容(目录在前、名称排序,Rust 侧限 500 条)。
 * relPath 传空字符串表示列工作区根目录。
 */
export async function listDir(relPath: string): Promise<LocalFileOpResult> {
  if (!getIsTauri()) return WEB_ONLY
  try {
    const r = await invoke<{
      absPath: string
      entries: { name: string; kind: 'dir' | 'file'; size: number }[]
      truncated: boolean
    }>('lf_list_dir', { relPath: relPath || '' })
    return { ok: true, absPath: r.absPath, entries: r.entries, truncated: r.truncated }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * 在文件内把 oldText 的唯一匹配处替换为 newText。
 * Rust 侧强制唯一匹配(0 处或多处都报错),匹配不上不会写盘——故无需用户确认。
 * @param relPath 相对工作区根的路径(文件上限 1MB)
 */
export async function editFile(
  relPath: string,
  oldText: string,
  newText: string
): Promise<LocalFileOpResult> {
  if (!getIsTauri()) return WEB_ONLY
  try {
    const r = await invoke<{ absPath: string; bytes: number; undoId: string | null }>('lf_edit_file', {
      relPath,
      oldTextBase64: utf8ToBase64(oldText),
      newTextBase64: utf8ToBase64(newText),
    })
    return { ok: true, absPath: r.absPath, bytes: r.bytes, undoId: r.undoId ?? undefined }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * 移动/重命名工作区内的文件或目录。目标已存在时 Rust 侧拒绝覆盖。
 * @param fromRel 源相对路径
 * @param toRel   目标相对路径
 */
export async function moveFile(fromRel: string, toRel: string): Promise<LocalFileOpResult> {
  if (!getIsTauri()) return WEB_ONLY
  try {
    const r = await invoke<{ absPath: string }>('lf_move_file', { fromRel, toRel })
    return { ok: true, absPath: r.absPath }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * 撤销一次破坏性写盘(覆盖写入/编辑):恢复到该操作前的内容;
 * 新建文件的撤销 = 把它移入回收站。纯 UI 动作,不进工具链路。
 * @param undoId 操作结果里带回的撤销记录 id
 */
export async function undoFile(undoId: string): Promise<LocalFileOpResult> {
  if (!getIsTauri()) return WEB_ONLY
  try {
    await invoke('lf_undo', { undoId })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * 递归目录树概览(3 层深,跳过 node_modules/.git 等,文件带大小):
 * 分析项目结构用,一次调用顶多次 list。纯只读。
 */
export async function overviewDir(relPath: string): Promise<LocalFileOpResult> {
  if (!getIsTauri()) return WEB_ONLY
  try {
    const r = await invoke<{
      absPath: string
      text: string
      truncated: boolean
      totalFiles: number
      totalDirs: number
    }>('lf_overview', { relPath })
    return {
      ok: true,
      absPath: r.absPath,
      text: r.text,
      truncated: r.truncated,
      totalFiles: r.totalFiles,
      totalDirs: r.totalDirs,
    }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * 跨文件搜索关键词(不区分大小写,跳过二进制/垃圾目录,上限 100 条):
 * 输出 文件:行号:内容 命中列表。纯只读,免 PowerShell 启动与确认。
 */
export async function searchContent(
  relPath: string,
  pattern: string,
  glob?: string
): Promise<LocalFileOpResult> {
  if (!getIsTauri()) return WEB_ONLY
  try {
    const r = await invoke<{
      absPath: string
      text: string
      truncated: boolean
      hits: number
      scannedFiles: number
    }>('lf_search', { relPath, pattern, glob: glob ?? null })
    return {
      ok: true,
      absPath: r.absPath,
      text: r.text,
      truncated: r.truncated,
      hits: r.hits,
      scannedFiles: r.scannedFiles,
    }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * 在工作区内执行 PowerShell 命令(cwd=工作区根):
 * 返回退出码/合并输出(UTF-8,超 8KB 截断)/耗时;是否需确认由调用方白名单判定。
 */
export async function execCommand(command: string): Promise<LocalFileOpResult> {
  if (!getIsTauri()) return WEB_ONLY
  try {
    const r = await invoke<{
      exitCode: number
      output: string
      truncated: boolean
      durationMs: number
    }>('lf_exec', { command })
    return {
      ok: true,
      exitCode: r.exitCode,
      execOutput: r.output,
      truncated: r.truncated,
      durationMs: r.durationMs,
    }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * 查询工作区内路径是否存在(create 覆盖确认用:存在则停等用户确认,不自动写入)。
 */
export async function fileExists(relPath: string): Promise<{ ok: boolean; exists: boolean }> {
  if (!getIsTauri()) return { ok: false, exists: false }
  try {
    const exists = await invoke<boolean>('lf_exists', { relPath })
    return { ok: true, exists }
  } catch {
    return { ok: false, exists: false }
  }
}

/**
 * 在系统资源管理器中定位文件/目录(explorer /select)。纯 UI 动作,不进工具链路。
 * 供卡片「打开位置」按钮与导出成功提示用。
 */
export async function revealFile(relPath: string): Promise<LocalFileOpResult> {
  if (!getIsTauri()) return WEB_ONLY
  try {
    await invoke('lf_reveal', { relPath })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * 把标题/任意名称转为安全的文件名主体:替换 Windows 非法字符、空白折叠为 _、
 * 去首尾 _、限长 60。导出文件命名用(write 画布导出 .md 等)。
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
  const safe = cleaned || 'untitled'
  return safe.slice(0, 60)
}
