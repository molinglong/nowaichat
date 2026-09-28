'use client'

/**
 * 工作区右栏「产物区」—— 工作态(仅桌面客户端)下右侧滑出并常驻的第二屏。
 *
 * 定位(AI 产物仓库):只做「AI 产物落盘 + 查看 / 编辑 + 预览」,不做构建、不装依赖、不起服务。
 * 布局口径:对话保持左主位,本栏只当右侧产物区,预览优先(HTML/SVG 直接可玩),
 * 「全部文件」收在底部一行 —— 要看源码 / 换文件再进文件视图。
 *
 * 数据源:
 * - 授权根:lf_get_base(Rust 侧持有的唯一授权工作区),未授权时给「选择文件夹」引导
 *   (强制选一次,无默认目录);同一份数据被设置弹窗与本地文件卡片共用。
 * - 本次产出:从当前对话消息里的 local_file 工具结果推导(create/edit/move 成功项,
 *   delete 移除),零后端改动;产物签名(path+bytes)进查询 key,AI 写完预览自动重读。
 * - 全部文件:lf_list_dir 惰性展开的工作区文件树(点文件=定位预览,悬停铅笔=Monaco 编辑)。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { UIMessage } from 'ai'
import {
  ChevronRight,
  ChevronsRight,
  ExternalLink,
  FileCode2,
  FilePlus2,
  FileText,
  FolderOpen,
  FolderTree,
  Loader2,
  Pencil,
  RotateCw,
  TriangleAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat-store'
import { useIsTauri } from '@/lib/tauri'
import {
  LOCAL_FILES_SYNC_KEY,
  getWorkspaceDir,
  listDir,
  pickWorkspaceDir,
  readFullFile,
  revealFile,
} from '@/lib/tauri-files'
import { toast } from '@/lib/toast'
import { extractToolCallViews } from '@/components/chat/ToolCallCard'
import { LOCAL_FILE_TOOL_NAME, isLocalFileOutput, toLocalFileView } from '@/lib/ai/local-file-tool'

/** 能在右栏直接预览的扩展名(srcDoc 单文件渲染;其余走 Monaco 编辑) */
const PREVIEWABLE_EXT = new Set(['html', 'htm', 'svg'])

/** 单文件预览可玩,但外部引用(相对路径的 css/js)解析不到 —— 如实提示,不让用户以为坏了 */
const SRCDOC_NOTE =
  '预览按单文件渲染：同目录的 css / js 不会被加载。多文件工程可「在编辑器中打开」,' +
  '或「打开位置」后用系统浏览器打开。'

interface WorkArtifact {
  path: string
  bytes: number
}

function extOf(p: string): string {
  const i = p.lastIndexOf('.')
  return i >= 0 ? p.slice(i + 1).toLowerCase() : ''
}

function fmtSize(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 从对话消息推导「本次产出」:local_file 的 create/edit/move 成功项,delete 移除同名项。
 * 同一路径多次写入只留一份并按最后写入排到末尾(最新产物 = 列表末位)。
 */
function deriveArtifacts(messages: UIMessage[]): WorkArtifact[] {
  const out: WorkArtifact[] = []
  const indexOf = (p: string) => {
    for (let i = 0; i < out.length; i++) if (out[i].path === p) return i
    return -1
  }
  for (const m of messages) {
    for (const v of extractToolCallViews(m)) {
      if (v.tool !== LOCAL_FILE_TOOL_NAME) continue
      const view = toLocalFileView(v.input)
      const o = isLocalFileOutput(v.output) ? v.output : null
      const action = o?.action ?? view.action
      if (action === 'delete') {
        const i = indexOf(view.path)
        if (o?.ok === true && i >= 0) out.splice(i, 1)
        continue
      }
      if (!o || o.ok !== true) continue
      if (action !== 'create' && action !== 'edit' && action !== 'move') continue
      const path = action === 'move' ? view.toPath : view.path
      if (!path) continue
      const i = indexOf(path)
      if (i >= 0) out.splice(i, 1)
      out.push({ path, bytes: typeof o.bytes === 'number' ? o.bytes : 0 })
    }
  }
  return out
}

export function WorkspacePane({ messages, embedded = false }: { messages: UIMessage[]; embedded?: boolean }) {
  const inTauri = useIsTauri()
  const workMode = useChatStore((s) => s.workMode)
  const setWorkMode = useChatStore((s) => s.setWorkMode)
  const workFile = useChatStore((s) => s.workFile)
  const setWorkFile = useChatStore((s) => s.setWorkFile)
  // [P1 改版]工作区两视图(预览/文件树)成为 Side Pane 的 tab,由 sideTab 驱动
  const sideTab = useChatStore((s) => s.sideTab)
  const setSideTab = useChatStore((s) => s.setSideTab)
  // embedded(挂进 WorkSidePane)时由父级管可见性;独立渲染按 workMode 开合
  const open = inTauri && (embedded || workMode)

  const qc = useQueryClient()
  const openEditor = useChatStore((s) => s.openEditor)

  // 授权根:同一个 query 被设置弹窗 / 本栏共用,选完文件夹 invalidate 即全局刷新
  const { data: base, isPending: basePending } = useQuery({
    queryKey: ['workspace', 'base'],
    queryFn: () => getWorkspaceDir(),
    enabled: inTauri,
    staleTime: 5 * 60_000,
  })

  const artifacts = useMemo(() => deriveArtifacts(messages), [messages])
  // 产物签名:进查询 key,AI 每次落盘后预览 / 文件树自动重读到最新磁盘内容
  const artifactSig = useMemo(
    () => artifacts.map((a) => `${a.path}#${a.bytes}`).join('|'),
    [artifacts]
  )

  // 定位的文件:用户手选优先,否则默认最新产物(预览 = 最新产物)
  const activePath = workFile ?? (artifacts.length > 0 ? artifacts[artifacts.length - 1].path : null)
  const activeArtifact = artifacts.find((a) => a.path === activePath) ?? null
  const activePreviewable = activePath ? PREVIEWABLE_EXT.has(extOf(activePath)) : false

  const {
    data: previewFile,
    isPending: previewPending,
    error: previewError,
    refetch: refetchPreview,
  } = useQuery({
    queryKey: ['workspace', 'file', activePath ?? '', artifactSig],
    queryFn: async () => {
      const r = await readFullFile(activePath as string)
      if (!r.ok || typeof r.content !== 'string') throw new Error(r.error || '读取失败')
      return { content: r.content, bytes: r.bytes ?? 0 }
    },
    enabled: open && sideTab === 'preview' && !!activePath && activePreviewable,
    staleTime: 60_000,
    retry: false,
  })

  const [picking, setPicking] = useState(false)
  const handlePick = useCallback(async () => {
    if (picking) return
    setPicking(true)
    try {
      const res = await pickWorkspaceDir()
      if (res.cancelled) return
      if (!res.ok || !res.base) {
        toast.error(res.error || '设置工作区失败')
        return
      }
      await qc.invalidateQueries({ queryKey: ['workspace'] })
      toast.success('工作区已授权', { title: '本地文件' })
    } finally {
      setPicking(false)
    }
  }, [picking, qc])

  // 跨窗口同步:设置子窗口里换了工作区文件夹 → 本窗口立即重读授权根
  // (同窗口的设置弹窗走 invalidate,见 SettingsModal.handlePickWorkspace)
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === LOCAL_FILES_SYNC_KEY) void qc.invalidateQueries({ queryKey: ['workspace'] })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [qc])

  const handleReveal = useCallback((relPath: string) => {
    void revealFile(relPath).then((r) => {
      if (!r.ok) toast.error(r.error || '打开位置失败')
    })
  }, [])

  // 双击/「预览」按钮 = 跳到预览 tab;单击 = 只选中(树不动)
  const handleOpenFile = useCallback(
    (relPath: string) => {
      setWorkFile(relPath)
      setSideTab('preview')
    },
    [setWorkFile, setSideTab]
  )

  if (!inTauri) return null

  const latest = artifacts.length > 0 ? artifacts[artifacts.length - 1] : null

  const body = (
    <div className={cn('flex flex-col h-full min-h-0 min-w-0', !embedded && 'w-full md:w-[min(34vw,440px)]')}>
      {/* 面板头:工作区 + 当前定位文件 + 授权根 + 收起 */}
      <div className="shrink-0 flex items-center gap-2 h-12 px-3 border-b border-line">
        <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
          <FolderTree className="w-3.5 h-3.5 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-content-primary truncate">
            工作区 · {activePath ?? (base ? '未定位文件' : '未选择文件夹')}
          </div>
          <div
            className="text-[10px] text-content-muted truncate"
            title={base ?? undefined}
          >
            {base ?? '选择后 AI 才能读写本地文件'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setWorkMode(false)}
          aria-label="收起产物区"
          title="收起产物区（回到纯聊天）"
          className="shrink-0 p-1.5 rounded-md text-content-secondary hover:text-content-primary
            hover:bg-surface-subtle transition-colors"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>

      {/* 主体:未授权=引导选文件夹;已授权=预览优先 / 全部文件 */}
      {open && (
        <div className="flex-1 min-h-0 flex flex-col">
          {!base ? (
            <div className="flex-1 min-h-0 grid place-items-center px-6">
              {basePending ? (
                <span className="inline-flex items-center gap-2 text-xs text-content-muted">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  正在读取工作区…
                </span>
              ) : (
                <div className="w-full max-w-[300px] rounded-xl border border-line bg-surface-muted/60 px-5 py-6 text-center">
                  <div className="w-9 h-9 mx-auto rounded-xl bg-accent/10 grid place-items-center">
                    <FilePlus2 className="w-4 h-4 text-accent" />
                  </div>
                  <div className="mt-3 text-sm text-content-primary font-medium">
                    先指定一个工作区文件夹
                  </div>
                  <div className="mt-1.5 text-xs text-content-muted leading-relaxed">
                    AI 生成的网页 / 脚本 / 文档会落到这个文件夹里，右侧直接预览；
                    聊天里的文件卡片、导出、编辑器也都指向它。
                  </div>
                  <button
                    type="button"
                    onClick={() => void handlePick()}
                    disabled={picking}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-foreground
                      transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {picking ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FolderOpen className="w-3.5 h-3.5" />
                    )}
                    选择文件夹…
                  </button>
                  <div className="mt-5 text-[11px] text-content-muted leading-relaxed">
                    没有默认目录，也不替你选：系统目录（Windows / Program Files 等）会被拒绝。
                    以后想换：设置 → 本地文件 → 工作区文件夹。
                  </div>
                </div>
              )}
            </div>
          ) : sideTab === 'files' ? (
            <>
              {/* 选中文件操作条:单击树只选中,操作收敛在这条上 */}
              {workFile && (
                <div className="shrink-0 flex items-center gap-1.5 border-b border-line bg-surface-muted/60 px-2.5 py-1.5">
                  <FileText className="w-3.5 h-3.5 shrink-0 text-content-muted" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-content-primary" title={workFile}>
                    {workFile}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSideTab('preview')}
                    className="shrink-0 rounded-md border border-line/60 px-2 py-0.5 text-[11px] text-content-secondary
                      hover:bg-surface-subtle hover:text-content-primary transition-colors"
                  >
                    预览
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditor(workFile)}
                    className="shrink-0 rounded-md border border-line/60 px-2 py-0.5 text-[11px] text-content-secondary
                      hover:bg-surface-subtle hover:text-content-primary transition-colors"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReveal(workFile)}
                    title="在资源管理器中显示"
                    className="shrink-0 rounded-md border border-line/60 p-0.5 text-content-secondary
                      hover:bg-surface-subtle hover:text-content-primary transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              )}
              <FileTree
                sig={artifactSig}
                activePath={activePath}
                onSelectFile={(p) => setWorkFile(p)}
                onOpenFile={handleOpenFile}
                onEditFile={openEditor}
              />
            </>
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-auto p-2.5 flex flex-col gap-2.5">
                {/* 产物切换:多于一个产物时,顶部一行文件 chip */}
                {artifacts.length > 1 && (
                  <div className="shrink-0 flex flex-wrap gap-1">
                    {[...artifacts].reverse().map((a) => (
                      <button
                        key={a.path}
                        type="button"
                        onClick={() => setWorkFile(a.path)}
                        title={a.path}
                        className={cn(
                          'max-w-full truncate rounded-md border px-1.5 py-0.5 text-[10.5px] font-mono transition-colors',
                          a.path === activePath
                            ? 'border-line-strong bg-surface-subtle text-content-primary'
                            : 'border-line text-content-muted hover:bg-surface-subtle hover:text-content-secondary'
                        )}
                      >
                        {a.path}
                      </button>
                    ))}
                  </div>
                )}

                {!activePath ? (
                  <div className="flex-1 min-h-0 grid place-items-center px-4">
                    <div className="text-center max-w-[280px]">
                      <FolderOpen className="w-8 h-8 mx-auto text-content-muted/50" />
                      <div className="mt-3 text-sm text-content-secondary">这个对话还没有产物</div>
                      <div className="mt-1.5 text-xs text-content-muted leading-relaxed">
                        在聊天里说「在工作区写个网页 / 脚本」，AI 落盘的文件会出现在这里，
                        并可直接预览。
                      </div>
                    </div>
                  </div>
                ) : activePreviewable ? (
                  <>
                    <div className="shrink-0 flex items-center gap-1.5 h-7 px-2 rounded-t-lg border border-line border-b-0 bg-surface-muted font-mono text-[10.5px] text-content-secondary">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="truncate">{activePath}</span>
                      <span className="shrink-0 text-content-muted">
                        · {fmtSize(activeArtifact?.bytes ?? previewFile?.bytes ?? 0)}
                      </span>
                      <span className="flex-1" />
                      <button
                        type="button"
                        onClick={() => void refetchPreview()}
                        title="重新读取磁盘内容刷新预览"
                        className="shrink-0 p-0.5 rounded text-content-muted hover:text-content-primary transition-colors"
                      >
                        <RotateCw className={cn('w-3 h-3', previewPending && 'animate-spin')} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditor(activePath)}
                        title="在编辑器中打开"
                        className="shrink-0 p-0.5 rounded text-content-muted hover:text-content-primary transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReveal(activePath)}
                        title="在资源管理器中打开位置"
                        className="shrink-0 p-0.5 rounded text-content-muted hover:text-content-primary transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="shrink-0 min-h-[220px] flex-1 rounded-b-lg border border-line overflow-hidden bg-white">
                      {previewError ? (
                        <div className="h-full grid place-items-center px-4 text-center">
                          <div>
                            <TriangleAlert className="w-5 h-5 mx-auto text-amber-500" />
                            <div className="mt-2 text-xs text-content-secondary">
                              {previewError instanceof Error ? previewError.message : '读取失败'}
                            </div>
                          </div>
                        </div>
                      ) : previewPending || !previewFile ? (
                        <div className="h-full grid place-items-center text-xs text-content-muted">
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            正在读取文件…
                          </span>
                        </div>
                      ) : (
                        <iframe
                          title={`预览 ${activePath}`}
                          srcDoc={previewFile.content}
                          sandbox="allow-scripts allow-forms allow-popups"
                          className="w-full h-full bg-white border-0"
                        />
                      )}
                    </div>
                    <div className="shrink-0 text-[11px] text-content-muted leading-relaxed">
                      {SRCDOC_NOTE}
                    </div>
                  </>
                ) : (
                  <div className="shrink-0 rounded-lg border border-line bg-surface-muted/60 px-3 py-3">
                    <div className="flex items-start gap-2">
                      <FileCode2 className="w-4 h-4 shrink-0 mt-0.5 text-content-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-xs text-content-primary">
                          {activePath}
                        </div>
                        <div className="mt-0.5 text-[11px] text-content-muted">
                          {fmtSize(activeArtifact?.bytes ?? 0)} · 该类型没有内嵌预览
                        </div>
                        <div className="mt-2 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditor(activePath)}
                            className="inline-flex items-center gap-1 rounded-md border border-line/60 px-2 py-1 text-[11px] text-content-secondary
                              hover:bg-surface-subtle hover:text-content-primary transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                            在编辑器中打开
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReveal(activePath)}
                            className="inline-flex items-center gap-1 rounded-md border border-line/60 px-2 py-1 text-[11px] text-content-secondary
                              hover:bg-surface-subtle hover:text-content-primary transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            打开位置
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {latest && activePath && latest.path !== activePath && (
                  <button
                    type="button"
                    onClick={() => setWorkFile(latest.path)}
                    className="shrink-0 inline-flex items-center gap-1 self-start rounded-md border border-line/60 px-2 py-1 text-[11px] text-content-secondary
                      hover:bg-surface-subtle hover:text-content-primary transition-colors"
                  >
                    <RotateCw className="w-3 h-3" />
                    回到最新产物 · {latest.path}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )

  // [P1 改版]embedded = 挂进 WorkSidePane 的 tab 内容;独立覆盖面板仅作为兜底保留
  if (embedded) return body
  return (
    <aside
      aria-hidden={!open}
      aria-label="工作区产物区"
      className={`fixed inset-y-0 right-0 z-[80] w-full md:w-[min(34vw,440px)] flex flex-col
        bg-surface border-l border-line shadow-2xl
        transition-transform duration-300 ease-out
        ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}`}
    >
      {body}
    </aside>
  )
}

/** 惰性展开的工作区文件树:点目录展开(单层 listDir),点文件名定位预览,悬停铅笔进 Monaco */
function FileTree({
  sig,
  activePath,
  onSelectFile,
  onOpenFile,
  onEditFile,
}: {
  sig: string
  activePath: string | null
  onSelectFile: (relPath: string) => void
  onOpenFile: (relPath: string) => void
  onEditFile: (relPath: string) => void
}) {
  const { data, isPending, error } = useQuery({
    queryKey: ['workspace', 'dir', '', sig],
    queryFn: async () => {
      const r = await listDir('')
      if (!r.ok) throw new Error(r.error || '列目录失败')
      return r.entries ?? []
    },
    staleTime: 30_000,
    retry: false,
  })

  return (
    <div className="flex-1 min-h-0 overflow-auto p-2">
      {isPending ? (
        <div className="grid h-full place-items-center text-xs text-content-muted">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            正在读取目录…
          </span>
        </div>
      ) : error ? (
        <div className="grid h-full place-items-center px-4 text-center text-xs text-content-secondary">
          {error instanceof Error ? error.message : '列目录失败'}
        </div>
      ) : (data ?? []).length === 0 ? (
        <div className="grid h-full place-items-center px-4 text-center text-xs text-content-muted">
          工作区还是空的
        </div>
      ) : (
        (data ?? []).map((e) =>
          e.kind === 'dir' ? (
            <DirRow
              key={e.name}
              relPath={e.name}
              name={e.name}
              sig={sig}
              activePath={activePath}
              onSelectFile={onSelectFile}
              onOpenFile={onOpenFile}
              onEditFile={onEditFile}
            />
          ) : (
            <FileRow
              key={e.name}
              relPath={e.name}
              name={e.name}
              size={e.size}
              active={activePath === e.name}
              onSelectFile={onSelectFile}
              onOpenFile={onOpenFile}
              onEditFile={onEditFile}
            />
          )
        )
      )}
    </div>
  )
}

function DirRow({
  relPath,
  name,
  sig,
  activePath,
  onSelectFile,
  onOpenFile,
  onEditFile,
}: {
  relPath: string
  name: string
  sig: string
  activePath: string | null
  onSelectFile: (relPath: string) => void
  onOpenFile: (relPath: string) => void
  onEditFile: (relPath: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { data, isPending } = useQuery({
    queryKey: ['workspace', 'dir', relPath, sig],
    queryFn: async () => {
      const r = await listDir(relPath)
      if (!r.ok) throw new Error(r.error || '列目录失败')
      return r.entries ?? []
    },
    enabled: expanded,
    staleTime: 30_000,
    retry: false,
  })

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-content-secondary
          hover:bg-surface-subtle hover:text-content-primary transition-colors"
      >
        <ChevronRight
          className={cn(
            'w-3 h-3 shrink-0 text-content-muted transition-transform',
            expanded && 'rotate-90'
          )}
        />
        <FolderOpen className="w-3.5 h-3.5 shrink-0 text-content-muted" />
        <span className="truncate">{name}</span>
      </button>
      {expanded && (
        <div className="pl-3">
          {isPending ? (
            <div className="px-2 py-1 text-[11px] text-content-muted">…</div>
          ) : (
            (data ?? []).map((e) =>
              e.kind === 'dir' ? (
                <DirRow
                  key={e.name}
                  relPath={`${relPath}/${e.name}`}
                  name={e.name}
                  sig={sig}
                  activePath={activePath}
                  onSelectFile={onSelectFile}
                  onOpenFile={onOpenFile}
                  onEditFile={onEditFile}
                />
              ) : (
                <FileRow
                  key={e.name}
                  relPath={`${relPath}/${e.name}`}
                  name={e.name}
                  size={e.size}
                  active={activePath === `${relPath}/${e.name}`}
                  onSelectFile={onSelectFile}
                  onOpenFile={onOpenFile}
                  onEditFile={onEditFile}
                />
              )
            )
          )}
        </div>
      )}
    </div>
  )
}

function FileRow({
  relPath,
  name,
  size,
  active,
  onSelectFile,
  onOpenFile,
  onEditFile,
}: {
  relPath: string
  name: string
  size: number
  active?: boolean
  onSelectFile: (relPath: string) => void
  onOpenFile: (relPath: string) => void
  onEditFile: (relPath: string) => void
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
        active
          ? 'bg-surface-subtle text-content-primary'
          : 'text-content-secondary hover:bg-surface-subtle hover:text-content-primary'
      )}
    >
      <button
        type="button"
        onClick={() => onSelectFile(relPath)}
        onDoubleClick={() => onOpenFile(relPath)}
        title={`${relPath}（双击进预览）`}
        className="min-w-0 flex-1 flex items-center gap-1.5 text-left"
      >
        <FileText className="w-3.5 h-3.5 shrink-0 text-content-muted" />
        <span className="truncate">{name}</span>
        <span className="shrink-0 font-mono text-[10px] text-content-muted/70">
          {fmtSize(size)}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onEditFile(relPath)}
        title="在编辑器中打开"
        className="shrink-0 rounded p-0.5 text-content-muted opacity-70 transition-all
          hover:bg-surface hover:text-content-primary hover:opacity-100 focus-visible:opacity-100"
      >
        <Pencil className="w-3 h-3" />
      </button>
    </div>
  )
}
