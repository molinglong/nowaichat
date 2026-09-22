import { tool } from "ai"
import { z } from "zod"

/**
 * 本地文件工具（local_file）—— 四期:九动作全能力
 * (create/delete/read/list/edit/move/exec/overview/search)
 *
 * 设计目标:让桌面客户端(Tauri)里的 AI 能在用户授权的工作区沙箱内,
 * 帮用户读写、整理、修改本地文件,并在工作区内执行 PowerShell 命令、
 * 高效分析项目(目录树概览 + 跨文件搜索 + 行范围精读)。
 *
 * 与 web_search 等工具的关键差异:无 execute —— 文件操作必须在用户本地机器执行,
 * 而 /api/chat 跑在远程服务器(远程壳架构,前端与后端都在 chat.yuban.icu),
 * 服务器碰不到用户磁盘。所以 tool call 输出后本轮流即结束(AI SDK 对无 execute
 * 工具不会自动续跑),前端 useChat.onToolCall 拦截,经 Tauri 命令在本地沙箱执行,
 * 再 addToolOutput 回填结果,配合 sendAutomaticallyWhen 触发自动续跑让模型收尾。
 *
 * 安全边界(多层):
 * - 仅在 Tauri 环境且用户开启了 localFilesEnabled 时,chat route 才注入本工具;
 * - 删除操作前端强制弹确认卡片(LocalFileCard),用户批准才执行;
 * - 所有路径限制在用户选定的工作区根内,Rust 侧 safe_join 二次校验(拒绝越界/系统目录);
 * - 删除走回收站(trash),可还原;edit 强制唯一匹配(0 处/多处都拒绝),匹配不上不写盘;
 * - move 拒绝覆盖已存在目标;read 只收 UTF-8 纯文本(二进制拒绝,超 64KB 截断);
 * - exec 只读白名单自动放行,其余命令(含写/联网 token、绝对路径、子表达式)强制弹确认卡。
 */

export const LOCAL_FILE_TOOL_NAME = "local_file"

export const localFileInputSchema = z.object({
  action: z
    .enum(["create", "delete", "read", "list", "edit", "move", "exec", "overview", "search"])
    .describe(
      "create=生成/覆盖写入文本文件;delete=移入回收站;read=读取文本文件(支持行范围);" +
        "list=列出目录单层内容;edit=替换文件内一段文本;move=移动/重命名;exec=在工作区内执行 PowerShell 命令;" +
        "overview=递归目录树概览;search=跨文件搜索关键词"
    ),
  path: z
    .string()
    .describe(
      "相对工作区根目录的路径(如 notes/todo.md、report.txt)。必须是相对路径,不要用盘符/" +
        "绝对路径,不要用 .. 越出工作区。list/overview/search/exec 传空字符串表示用工作区根目录,其余 action 必填。"
    ),
  content: z
    .string()
    .optional()
    .describe(
      "create 时写入的完整纯文本内容(UTF-8);同名文件会被覆盖。其余 action 忽略此字段。"
    ),
  old_text: z
    .string()
    .optional()
    .describe(
      "edit 时要被替换的原文片段——必须逐字与文件现有内容一致,且在整个文件中只出现一次" +
        "(务必先 read 确认原文再 edit)。其余 action 忽略此字段。"
    ),
  new_text: z
    .string()
    .optional()
    .describe("edit 时替换后的新文本(传空字符串表示删除该片段)。其余 action 忽略此字段。"),
  to_path: z
    .string()
    .optional()
    .describe(
      "move 的目标相对路径(同一相对路径规则),可实现重命名或移动到子目录。" +
        "目标已存在会失败。其余 action 忽略此字段。"
    ),
  command: z
    .string()
    .optional()
    .describe(
      "exec 时要执行的 PowerShell 命令(工作目录为工作区根,输出上限 8KB,超时 30 秒)。" +
        "只读白名单命令会自动执行,其余命令会弹确认卡等待用户批准。其余 action 忽略此字段。"
    ),
  offset: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "read 可选:起始行号(1-based),配合 limit 做范围读取,避免把整个大文件读进上下文。其余 action 忽略。"
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("read 可选:最多读取的行数(上限 800)。其余 action 忽略。"),
  mode: z
    .enum(["full", "outline"])
    .optional()
    .describe(
      "read 可选:full=读内容(默认);outline=只返回结构骨架(export/function/class 等结构行+行号,上限 300 行)——大文件先 outline 看结构,再按行号精读目标段落。其余 action 忽略。"
    ),
  pattern: z
    .string()
    .optional()
    .describe(
      "search 必填:要搜索的文本关键词(不区分大小写,支持任意子串)。其余 action 忽略此字段。"
    ),
  glob: z
    .string()
    .optional()
    .describe(
      "search 可选:文件名后缀过滤,如 \"*.ts\"、\"*.md\"。其余 action 忽略此字段。"
    ),
})

export type LocalFileToolInput = z.infer<typeof localFileInputSchema>
export type LocalFileAction =
  | "create"
  | "delete"
  | "read"
  | "list"
  | "edit"
  | "move"
  | "exec"
  | "overview"
  | "search"

/**
 * 前端执行后回填给模型的结果形状。
 * 会随消息 metadata.toolCalls 持久化,历史回放时由 LocalFileCard 渲染。
 */
export interface LocalFileToolOutput {
  ok: boolean
  action?: LocalFileAction
  /** 实际落盘/删除的绝对路径(成功时) */
  absPath?: string
  /** create 成功时写入的字节数 */
  bytes?: number
  /** delete 成功=true 表示已移入回收站 */
  trashed?: boolean
  /** read 成功时返回的文本内容(超 64KB 截断) */
  content?: string
  /** read/list 结果被截断 */
  truncated?: boolean
  /** read:文件总行数 */
  totalLines?: number
  /** read:还有后续内容时,下次 read 应传的 offset(1-based);已读完为空 */
  nextOffset?: number
  /** list 成功时的目录条目(单层) */
  entries?: { name: string; kind: "dir" | "file"; size: number }[]
  /** write(覆盖/新建)/edit 成功时的撤销记录 id,卡片用它一键恢复操作前内容 */
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
  /** 失败/被拒原因(回传给模型,让它向用户解释,不臆造成功) */
  error?: string
  /** 用户在确认卡片上点了拒绝 */
  denied?: boolean
}

export function isLocalFileOutput(o: unknown): o is LocalFileToolOutput {
  return !!o && typeof o === "object" && "ok" in (o as Record<string, unknown>)
}

/** 前端渲染用的宽松视图(历史 metadata 里 input 可能缺字段,逐项兜底) */
export interface LocalFileView {
  action: LocalFileAction | "unknown"
  path: string
  hasContent: boolean
  /** create 的完整内容(覆盖确认批准执行时回传 ChatPanel 用) */
  content: string
  /** edit 的原文片段是否存在(供卡片预览) */
  hasOldText: boolean
  /** move 的目标相对路径 */
  toPath: string
  /** exec 的命令文本 */
  command: string
  /** search 的关键词 */
  pattern: string
  /** search 的文件后缀过滤(如 "*.ts") */
  glob: string
}

/**
 * 卡片决策回调的载荷:动作类型 + create 覆盖时的写入内容 / exec 的命令文本。
 * ChatPanel 的 handleLocalFileDecision 据此分派执行。
 */
export interface LocalFileDecision {
  action: "delete" | "create" | "exec"
  content?: string
  command?: string
}

const ACTIONS: readonly LocalFileAction[] = [
  "create",
  "delete",
  "read",
  "list",
  "edit",
  "move",
  "exec",
  "overview",
  "search",
]

/**
 * 从任意来源(tool part input / 历史 metadata input)提取可渲染视图,
 * 字段缺失或类型不符时回退,不让一张坏卡片阻塞整条消息渲染。
 */
export function toLocalFileView(input: unknown): LocalFileView {
  const fallback: LocalFileView = {
    action: "unknown",
    path: "",
    hasContent: false,
    content: "",
    hasOldText: false,
    toPath: "",
    command: "",
    pattern: "",
    glob: "",
  }
  if (!input || typeof input !== "object") return fallback
  const raw = input as {
    action?: unknown
    path?: unknown
    content?: unknown
    old_text?: unknown
    to_path?: unknown
    command?: unknown
    pattern?: unknown
    glob?: unknown
  }
  const action: LocalFileView["action"] = ACTIONS.includes(raw.action as LocalFileAction)
    ? (raw.action as LocalFileAction)
    : "unknown"
  const path = typeof raw.path === "string" ? raw.path : ""
  const content = typeof raw.content === "string" ? raw.content : ""
  const hasOldText = typeof raw.old_text === "string" && raw.old_text.length > 0
  const toPath = typeof raw.to_path === "string" ? raw.to_path : ""
  const command = typeof raw.command === "string" ? raw.command : ""
  const pattern = typeof raw.pattern === "string" ? raw.pattern : ""
  const glob = typeof raw.glob === "string" ? raw.glob : ""
  return {
    action,
    path,
    hasContent: content.length > 0,
    content,
    hasOldText,
    toPath,
    command,
    pattern,
    glob,
  }
}

/**
 * 创建本地文件工具（无 execute,见文件头注释）
 */
export function createLocalFileTool() {
  return tool({
    description:
      "在用户授权的本地工作区文件夹内管理与分析文件(仅桌面客户端可用):生成/写入(create)、" +
      "删除到回收站(delete,需用户确认)、读取文本内容(read,支持行范围)、列出目录(list)、" +
      "精确替换文本(edit)、移动/重命名(move)、执行 PowerShell 命令(exec,只读白名单自动/其余需确认)、" +
      "递归目录树概览(overview)、跨文件搜索关键词(search)。分析项目结构或定位代码时优先用 overview+search。",
    inputSchema: localFileInputSchema,
  })
}

/**
 * 注入 system prompt 的使用规则段（职责分层同 CLARIFY_TOOL_PROMPT）。
 */
export const LOCAL_FILE_TOOL_PROMPT: string = [
  "## 本地文件操作（local_file 工具，仅桌面客户端）",
  "- 你已获用户授权,可在其本地「工作区」文件夹内读写、整理文件——这是对用户机器上真实文件的操作,务必谨慎、如实。",
  "- path 一律用相对工作区根目录的相对路径(如 notes/plan.md),不要用盘符或绝对路径,不要用 .. 越出工作区;越界或指向系统目录会被拒绝。",
  "- create:把要写入的完整文本放进 content(UTF-8 纯文本),同名文件会被覆盖。适合导出对话、生成文档/代码/清单等。",
  "- delete:界面会弹出确认卡片,用户点「批准」后才真正执行(移入回收站,可还原);若收到 denied 结果说明用户拒绝,不要重试删除,尊重用户决定。",
  "- read:读取文本文件内容(单次输出上限 64KB);二进制/非 UTF-8 文件会失败。大文件先用 mode:'outline' 拿结构骨架(结构行+行号,一次看清全文件),再按行号用 offset/limit(单页上限 800 行)精读目标段落;结果带 nextOffset 说明后面还有内容,需要时从该行继续读;不要盲目通读整个文件。",
  "- list:列出目录的单层内容(名称/类型/大小);path 传空字符串表示列工作区根目录。",
  "- overview:递归目录树(path 默认工作区根,3 层深,自动跳过 node_modules/.git 等),文件带大小——分析项目结构时用它,一次顶多次 list。",
  "- search:跨文件搜索关键词(path 为目录或文件,支持 glob 后缀过滤如 \"*.ts\"),输出 文件:行号:内容 命中列表,上限 100 条——定位代码/内容时优先用它,比逐个 read 快得多。",
  "- edit:把文件内 old_text 唯一匹配处替换为 new_text——old_text 必须逐字一致且全文仅出现一次,0 处或多处匹配都会失败。修改前务必先 read 拿到准确原文;失败时重新 read 再用更长/更准的片段重试,不要盲改。",
  "- move:把文件/目录移动或重命名为 to_path;目标已存在会失败。",
  "- exec:在工作区内执行 PowerShell 命令(工作目录=工作区根,path 传空字符串),适合批量重命名、跨文件搜索、调用 git/ffmpeg 等系统工具。命令必须用 PowerShell 语法;输出上限 8KB(超出截断),超时 30 秒会被强杀。只读白名单命令(Get-ChildItem/Get-Content/Select-String/Test-Path/git status 等)自动执行;其余命令(写入/删除/联网/系统操作/绝对路径/管道拼接)会弹确认卡等待用户批准,被拒后不要原样重试,改用文件工具或向用户说明。禁止:访问工作区外路径、下载执行、修改系统配置。",
  "- 一次只操作一个文件,需要多个文件时分多次调用;不要臆造工具未返回的成功结果。",
  "- 效率规则:需要多个互不依赖的文件内容/多条信息时,在同一次回复里一并发出多个工具调用(它们会被并发执行),不要一次只发一个;分析项目时按 overview 全景 → search 定位 → 大文件 outline 骨架 → read 行范围精读的顺序,禁止逐文件通读。",
  "- 收到工具结果后用一句话向用户确认(成功:给出文件路径或结果摘要;失败:说明原因)。",
].join("\n")

/** exec 自动放行的只读首词:工作区内"安全浏览"命令,自动执行不弹确认 */
const EXEC_AUTO_FIRST_WORDS = new Set([
  "get-childitem", "gci", "ls", "dir",
  "get-content", "gc", "cat", "type",
  "select-string", "sls", "findstr",
  "get-item", "test-path", "measure-object", "compare-object", "get-filehash",
  "get-date", "get-location", "get-command", "where.exe", "where",
  "get-help", "get-alias",
])

/** git 只读子命令白名单(clone/fetch/push/commit 等写/联网操作不在内) */
const EXEC_GIT_READ_SUB = new Set(["status", "log", "diff", "show", "rev-parse", "branch"])

/**
 * exec 确认档黑名单:命中任意一条即需人工确认(全文扫描,管道右侧/字符串里也查,安全侧从严)。
 * 覆盖:语句分隔与重定向(; & < > `)、子表达式 $(、相对/绝对/UNC/家目录路径逃逸、
 * 环境变量引用、PowerShell 写/副作用动词族、传统高危 exe 与别名。
 */
const EXEC_CONFIRM_PATTERNS: readonly RegExp[] = [
  /[;&<>`]/,
  /\$\(/,
  /\.\./,
  /\$env:/i,
  /\$home/i,
  /~/,
  /[a-z]:[\\/]/i,
  /\\\\/,
  /\b(set|new|add|clear|remove|move|copy|rename|export|import|start|stop|restart|suspend|resume|disable|enable|update|reset|invoke|enter|exit|out|write|send|register|unregister|hide|show|unlock|block|grant|revoke)-[a-z]/i,
  /\b(del|erase|rd|rmdir|rm|mv|cp|md|mkdir|touch|kill|taskkill|format|curl|wget|ssh|scp|sftp|ftp|telnet|nc|net|netsh|reg|regedit|sc|schtasks|attrib|icacls|takeown|msiexec|rundll32|regsvr32|mshta|wscript|cscript|cmd|powershell|pwsh|bash|sh|run|call|robocopy|xcopy|expand|makecab|certutil|bitsadmin)\b/i,
]

/**
 * 判定 exec 命令是否可自动执行(无需用户确认):
 * 白名单首词或 git 只读子命令,且全文不命中任何确认档特征。
 * 判定在前端做(与 delete/create 确认流同层),卡片复用同一函数保持双端一致。
 */
export function isExecAutoAllowed(command: string): boolean {
  const raw = command.trim()
  if (!raw) return false
  for (const re of EXEC_CONFIRM_PATTERNS) {
    if (re.test(raw)) return false
  }
  const words = raw.split(/\s+/)
  const first = (words[0] ?? "").toLowerCase()
  if (first === "git") {
    return words.length > 1 && EXEC_GIT_READ_SUB.has((words[1] ?? "").toLowerCase())
  }
  return EXEC_AUTO_FIRST_WORDS.has(first)
}
