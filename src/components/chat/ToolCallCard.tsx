'use client'

import { memo, useState } from 'react'
import { BookOpen, Brain, Check, ChevronDown, Globe, Link2, ListTodo, Loader2, Plug, Search, Settings2, TriangleAlert, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UIMessage } from 'ai'
import { ClarifyCard } from './ClarifyCard'
import { LocalFileCard } from './LocalFileCard'
import { GenerateMaskCard } from './GenerateMaskCard'
import { WriteDocCard } from './WriteDocCard'
import { TripMapCard } from './TripMapCard'
import { CLARIFY_TOOL_NAME } from '@/lib/ai/clarify'
import { LOCAL_FILE_TOOL_NAME } from '@/lib/ai/local-file-tool'
import { MASK_TOOL_NAME } from '@/lib/ai/mask-tool'
import { WRITE_DOC_TOOL_NAME } from '@/lib/ai/write-doc-tool'
import { TRIP_TOOL_NAME } from '@/lib/ai/trip-tool'
import { SETTINGS_TOOL_NAME } from '@/lib/ai/settings-tool'
import { MEMORY_TOOL_NAME } from '@/lib/ai/memory-tool'
import { KNOWLEDGE_TOOL_NAME } from '@/lib/ai/knowledge-tool'
import { TODO_TOOL_NAME, type TodoToolOutput } from '@/lib/ai/todo-tool'
import { URL_READER_TOOL_NAME, type UrlReaderOutput } from '@/lib/ai/url-reader'
import { parseMcpToolDisplay } from '@/lib/ai/mcp/mcp-constants'
import { getSettingDef, formatSettingValue } from '@/lib/settings/registry'

/**
 * 工具调用卡片 —— 渲染 AI 工具调用过程,让"模型查资料"对用户可见可信。
 *
 * 数据双来源(在 extractToolCallViews 中归一为 ToolCallView):
 * - 流式/当轮: UIMessage.parts 里 type 形如 'tool-<name>' 的 part(AI SDK v7 原生)
 * - 历史: Message.metadata 里 kind='tool_calls' 的持久化明细(chat route onFinish 写入)
 *
 * 渲染策略:
 * - web_search: 搜索中 spinner;完成后折叠为"已搜索 N 条来源",展开显示来源列表
 * - 未知工具: 灰色一行兜底(扩展位,阶段二/三的新工具走同一协议)
 */
export interface ToolCallView {
  /** 工具名(不含 'tool-' 前缀) */
  tool: string
  toolCallId?: string
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
  input: unknown
  output: unknown
  errorText?: string
}

/** web_search 工具的 output 形状(见 lib/ai/search.ts execute) */
interface WebSearchOutput {
  query?: string
  engine?: string
  results?: Array<{ title: string; url?: string; snippet?: string }>
  note?: string
  error?: string
}

function isWebSearchOutput(o: unknown): o is WebSearchOutput {
  return !!o && typeof o === 'object' && Array.isArray((o as WebSearchOutput).results)
}

/** 历史消息 metadata 的工具明细形状(chat route onFinish 写入) */
interface ToolCallsMetadata {
  kind: 'tool_calls'
  version?: number
  toolCalls?: Array<{ tool?: string; input?: unknown; output?: unknown }>
}

/**
 * 从 UIMessage 提取工具调用视图,流式 parts 优先,历史 metadata 兜底。
 * 两来源互斥(当轮消息 parts 必有数据;历史消息 parts 无 tool part 才读 metadata),不会重复渲染。
 */
export function extractToolCallViews(message: UIMessage): ToolCallView[] {
  // 来源 A: AI SDK 流式/当轮 parts(type 形如 'tool-<name>';dynamic-tool 暂不支持,v1 只处理静态工具)
  const partViews: ToolCallView[] = []
  for (const p of message.parts) {
    const t = (p as { type?: string }).type ?? ''
    if (!t.startsWith('tool-') || t === 'tool-') continue
    partViews.push({
      tool: t.slice(5),
      toolCallId: (p as { toolCallId?: string }).toolCallId,
      state: ((p as { state?: string }).state ?? 'input-available') as ToolCallView['state'],
      input: (p as { input?: unknown }).input,
      output: (p as { output?: unknown }).output,
      errorText: (p as { errorText?: string }).errorText,
    })
  }
  if (partViews.length > 0) return partViews
  // 来源 B: 历史消息(metadata.toolCalls,由 chat route onFinish 写入)
  const meta = (message as { metadata?: unknown }).metadata as ToolCallsMetadata | undefined
  if (meta?.kind === 'tool_calls' && Array.isArray(meta.toolCalls)) {
    return meta.toolCalls.map((c, i) => {
      const out = c.output as { error?: string } | undefined
      return {
        tool: c.tool ?? 'unknown',
        toolCallId: `persisted-${i}`,
        state: out?.error ? 'output-error' : 'output-available',
        input: c.input ?? null,
        output: c.output ?? null,
      }
    })
  }
  return []
}

/** 从 view 提取搜索关键词(input 流式期间可能不完整,优先读 output) */
function extractQuery(view: ToolCallView): string {
  if (isWebSearchOutput(view.output) && view.output.query) return view.output.query
  const q = (view.input as { query?: string } | undefined)?.query
  return typeof q === 'string' ? q : ''
}

/**
 * 一行式工具卡片基础件:统一容器/图标/文案/状态反馈。
 * 中性灰规范:反馈色仅小面积 —— 失败态容器保持中性灰,红色只落在
 * 右侧「未生效」文案与警号图标上;成功态用 muted 色 Check,不打扰。
 * 流式(input-streaming)显示 spinner,提示"参数正在生成/正在执行"。
 */
function ToolRow({
  icon,
  text,
  streaming = false,
  failed = false,
}: {
  icon: React.ReactNode
  text: string
  streaming?: boolean
  failed?: boolean
}) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-lg border border-line/60 bg-surface-muted px-2.5 py-1.5 text-xs"
      title={text}
    >
      <span className="flex shrink-0 items-center text-content-secondary">{icon}</span>
      <span className="min-w-0 truncate text-content-secondary">{text}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {streaming ? (
          <Loader2 className="w-3 h-3 animate-spin text-content-muted" />
        ) : failed ? (
          <>
            <span className="text-red-500">未生效</span>
            <TriangleAlert className="w-3 h-3 text-red-500" />
          </>
        ) : (
          <Check className="w-3 h-3 text-content-muted" />
        )}
      </span>
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** MCP 工具参数摘要:取 input 里第一个非空字符串字段截断(通用,不绑定具体工具 schema) */
function mcpArgBrief(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  for (const v of Object.values(input as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) {
      const s = v.trim().replace(/\s+/g, ' ')
      return s.length > 42 ? `${s.slice(0, 42)}…` : s
    }
  }
  return ''
}

/** MCP 错误摘要:压缩空白后截断 —— 一行式卡片放不下长堆栈,保留可读根因 */
function mcpErrBrief(err: string | undefined | null): string {
  if (!err) return ''
  const s = err.replace(/\s+/g, ' ').trim()
  return s.length > 60 ? `${s.slice(0, 60)}…` : s
}

/** ToolCallCard 渲染入参:除工具视图外,携带澄清卡片的交互回调与已答状态 */
interface ToolCallCardProps {
  view: ToolCallView
  /** ask_clarification:该消息之后是否已有 user 消息(已答则卡片锁定) */
  clarifyAnswered?: boolean
  /** ask_clarification:提交回答文本(走 sendMessage 全链路);缺省则卡片只读 */
  onClarifySubmit?: (answersText: string) => void
  /** local_file:决策(批准/拒绝);缺省则待确认卡片只读 */
  onLocalFileDecision?: (
    toolCallId: string,
    path: string,
    approved: boolean,
    decision: import('@/lib/ai/local-file-tool').LocalFileDecision
  ) => void
}

function ToolCallCardInner({ view, clarifyAnswered, onClarifySubmit, onLocalFileDecision }: ToolCallCardProps) {
  // hooks 置顶(web_search 的展开状态),避免条件 return 造成 hooks 顺序不稳定
  const [manual, setManual] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // 澄清提问:专用交互卡片(问题+选项点选),不进通用工具卡分支
  if (view.tool === CLARIFY_TOOL_NAME) {
    return <ClarifyCard view={view} answered={clarifyAnswered ?? false} onSubmit={onClarifySubmit} />
  }

  // 本地文件操作:专用卡片(create 自动执行展示结果;delete 待确认→批准后执行)
  if (view.tool === LOCAL_FILE_TOOL_NAME) {
    return <LocalFileCard view={view} onDecision={onLocalFileDecision} />
  }

  // 面具工坊:专用交互卡片(草稿预览+一键添加),不进通用工具卡分支
  if (view.tool === MASK_TOOL_NAME) {
    return <GenerateMaskCard view={view} />
  }

  // 写作文档:一行式卡片(成功→打开按钮;流式→占位;失败→标红)
  if (view.tool === WRITE_DOC_TOOL_NAME) {
    return <WriteDocCard view={view} />
  }

  // 行程规划:地图卡片(AI 结构化行程,前端段间真实路径规划+时间线联动+全屏总览)
  if (view.tool === TRIP_TOOL_NAME) {
    return <TripMapCard view={view} />
  }

  // AI 设置控制:一行式卡片,列出全部操作(注册表中文映射);白名单拒绝时右侧标「未生效」
  if (view.tool === SETTINGS_TOOL_NAME) {
    const ops =
      (view.input as { operations?: Array<{ key: string; value: string }> } | undefined)?.operations ?? []
    const failed =
      view.state === 'output-error' || (view.output as { ok?: boolean } | undefined)?.ok === false
    const text =
      ops.length > 0
        ? `应用设置：${ops
            .map((op) => `${getSettingDef(op.key)?.label ?? op.key}→${formatSettingValue(op.key, op.value)}`)
            .join('、')}`
        : '应用设置'
    return <ToolRow icon={<Settings2 className="w-3.5 h-3.5" />} text={text} streaming={view.state === 'input-streaming'} failed={failed} />
  }

  // 显式记忆添加:一行式卡片列出已保存的记忆内容;服务端写库,这里只展示
  if (view.tool === MEMORY_TOOL_NAME) {
    const items =
      (view.input as { memories?: Array<{ content?: string }> } | undefined)?.memories ?? []
    const out = view.output as { ok?: boolean; saved?: string[] } | undefined
    const failed = view.state === 'output-error' || out?.ok === false
    // 展示优先用服务端确认的实际入库内容(execute 会去重/拒超长),流式期间回退到 input
    const contents = out?.saved?.length ? out.saved : items.map((m) => m.content ?? '').filter(Boolean)
    const text =
      contents.length > 0
        ? `${view.state === 'output-available' && !failed ? '已记住' : '记住'}：${contents.join('；')}`
        : view.state === 'input-streaming'
          ? '正在保存记忆…'
          : '保存记忆'
    return <ToolRow icon={<Brain className="w-3.5 h-3.5" />} text={text} streaming={view.state === 'input-streaming'} failed={failed} />
  }

  // 待办管理:一行式卡片,按操作类型展示;服务端写库,这里只展示
  if (view.tool === TODO_TOOL_NAME) {
    const input = view.input as
      | { operation?: string; items?: Array<{ content?: string }>; match?: string }
      | undefined
    const out = view.output as TodoToolOutput | undefined
    const failed = view.state === 'output-error' || out?.ok === false
    const op = out?.operation ?? input?.operation
    // 展示优先用服务端确认的实际入库内容,流式期间回退 input 预览
    let text: string
    if (view.state === 'input-streaming') {
      const preview = input?.items?.map((t) => t.content ?? '').filter(Boolean).join('；')
      text = preview ? `正在添加待办「${preview}」…` : input?.match ? `正在操作待办「${input.match}」…` : '正在操作待办…'
    } else if (out?.candidates?.length) {
      // 模糊匹配命中多条:列出候选项,由模型向用户澄清
      text = `待办匹配到多条：${out.candidates.join('；')}`
    } else if (out?.ok === false && out.message) {
      text = `未生效：${out.message}`
    } else if (op === 'add' && out?.added?.length) {
      text = `已添加待办：${out.added.map((t) => t.content).join('；')}`
    } else if (op === 'complete' && out?.completed?.length) {
      text = `已完成：${out.completed.join('；')}`
    } else if (op === 'delete' && out?.deleted?.length) {
      text = `已删除：${out.deleted.join('；')}`
    } else if (op === 'list' && out?.todos) {
      const undone = out.todos.filter((t) => !t.done).length
      text = undone > 0 ? `查看待办 · ${undone} 条未完成` : '查看待办 · 列表为空或已全部完成'
    } else {
      text = failed ? '待办操作未生效' : '待办操作'
    }
    return <ToolRow icon={<ListTodo className="w-3.5 h-3.5" />} text={text} streaming={view.state === 'input-streaming'} failed={failed} />
  }

  // 课本知识库检索:一行式卡片;流式显示检索词,完成后显示命中段数(详见 ToolRow 规范)
  if (view.tool === KNOWLEDGE_TOOL_NAME) {
    const kOut = view.output as
      | { query?: string; results?: Array<{ heading?: string }>; error?: string }
      | undefined
    const kQuery = kOut?.query ?? (view.input as { query?: string } | undefined)?.query ?? ''
    const kCount = kOut?.results?.length ?? 0
    const kFailed = view.state === 'output-error' || !!kOut?.error
    const kText =
      view.state === 'input-streaming'
        ? `正在翻课本「${kQuery}」…`
        : kFailed
          ? `查课本「${kQuery}」未生效`
          : kCount > 0
            ? `查课本「${kQuery}」· 命中 ${kCount} 段`
            : `查课本「${kQuery}」· 课本中未找到`
    return <ToolRow icon={<BookOpen className="w-3.5 h-3.5" />} text={kText} streaming={view.state === 'input-streaming'} failed={kFailed} />
  }

  // 全文阅读:一行式卡片;流式显示目标域名,完成后显示类型与域名;服务端 fetch,这里只展示
  // streaming 涵盖 input-available:服务端 fetch 最长 15s,这期间必须持续转圈避免“假卡死”
  if (view.tool === URL_READER_TOOL_NAME) {
    const input = view.input as { url?: string } | undefined
    const out = view.output as UrlReaderOutput | undefined
    const failed = view.state === 'output-error' || !!out?.error
    const url = out?.url ?? input?.url ?? ''
    const host = hostOf(url)
    const kindLabel = out?.kind === 'pdf' ? 'PDF' : out?.kind === 'text' ? '文本' : '网页'
    const pending = view.state === 'input-streaming' || view.state === 'input-available'
    const text =
      pending
        ? host
          ? `正在读取 ${host}…`
          : '正在读取链接…'
        : failed
          ? `读取${host ? ` ${host}` : '链接'}未生效`
          : `已读取${kindLabel} · ${host}`
    return <ToolRow icon={<Link2 className="w-3.5 h-3.5" />} text={text} streaming={pending} failed={failed} />
  }

  // 用户手动切换后交还控制权,不再自动变化。
  const autoOpen = view.state !== 'output-available'
  const isOpen = manual ? expanded : autoOpen
  const toggle = () => {
    setManual(true)
    setExpanded((v) => !v)
  }

  // ---- MCP 动态工具:从 mcp_<slug>_<tool> 解析出「服务 · 工具」展示 ----
  // MCP 外部调用耗时最长(网络往返 5~15s),streaming 涵盖 input-available:
  // 参数到位后真正在执行,必须持续转圈;完成后展示参数摘要,失败带原因。
  const mcpDisplay = parseMcpToolDisplay(view.tool)
  if (mcpDisplay) {
    // MCP 结果结构(MCP spec CallToolResult): { content: [{type:'text',text}], isError? }
    const out = view.output as
      | { content?: Array<{ text?: string }>; isError?: boolean; error?: string }
      | undefined
    // 失败判定:SDK 层错误(output-error)/ MCP 协议层错误(isError)/ 业务 error 字段
    const failed = view.state === 'output-error' || out?.isError === true || !!out?.error
    const argBrief = mcpArgBrief(view.input)
    const pending = view.state === 'input-streaming' || view.state === 'input-available'
    const text = pending
      ? `正在调用 ${mcpDisplay}${argBrief ? ` 「${argBrief}」` : ''}…`
      : failed
        ? `${mcpDisplay} 未生效${mcpErrBrief(view.errorText ?? out?.error) ? `：${mcpErrBrief(view.errorText ?? out?.error)}` : ''}`
        : argBrief
          ? `${mcpDisplay} · 「${argBrief}」`
          : `调用 ${mcpDisplay}`
    return (
      <ToolRow
        icon={<Plug className="w-3.5 h-3.5" />}
        text={text}
        streaming={pending}
        failed={failed}
      />
    )
  }

  // ---- 未知工具兜底 ----
  if (view.tool !== 'web_search') {
    return (
      <ToolRow
        icon={<Wrench className="w-3.5 h-3.5 text-content-muted" />}
        text={`调用了 ${view.tool}`}
        streaming={view.state === 'input-streaming'}
        failed={view.state === 'output-error'}
      />
    )
  }

  // ---- web_search 渲染 ----
  const query = extractQuery(view)
  const out = isWebSearchOutput(view.output) ? view.output : null
  const results = out?.results ?? []
  const hasError =
    view.state === 'output-error' || (out?.error != null && out.error !== '')
  const running = view.state === 'input-streaming' || view.state === 'input-available'

  return (
    <div className="rounded-lg border border-line/60 bg-surface-muted overflow-hidden text-xs">
      <button
        onClick={toggle}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-surface-subtle transition-colors text-left"
        aria-expanded={isOpen}
      >
        <Search className="w-3.5 h-3.5 shrink-0 text-content-secondary" />
        <span className="min-w-0 truncate text-content-primary">
          {query ? <>搜索「{query}」</> : '联网搜索'}
        </span>
        <span className="ml-auto flex items-center gap-1 shrink-0 text-content-muted">
          {running ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              搜索中…
            </>
          ) : hasError ? (
            <>
              <TriangleAlert className="w-3 h-3 text-red-500" />
              <span className="text-red-500">搜索失败</span>
            </>
          ) : (
            <>
              <Globe className="w-3 h-3" />
              {results.length} 条来源
            </>
          )}
          <ChevronDown
            className={cn('w-3 h-3 transition-transform', isOpen ? '' : '-rotate-90')}
          />
        </span>
      </button>

      {/* 展开区:常驻 DOM + grid-rows 过渡,收起/展开有顺滑的高度动画 */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
        <div className="px-2.5 pb-2 pt-0.5 flex flex-col gap-1.5">
          {/* 错误信息(工具执行失败或搜索 API 报错) */}
          {(hasError || view.errorText) && (
            <p className="text-red-500/90 break-words">
              {view.errorText || out?.error || '搜索失败'}
            </p>
          )}
          {results.length === 0 && !hasError && (
            <p className="text-content-muted break-words">未找到相关结果</p>
          )}
          {results.map((r, i) => {
            const host = r.url ? hostOf(r.url) : ''
            const clickable = !!r.url && !!host
            const inner = (
              <>
                {/* 首字母站标:避免第三方 favicon 服务的外部请求与离线破图 */}
                <span className="flex-shrink-0 w-4 h-4 rounded bg-accent/15 text-accent flex items-center justify-center text-[10px] font-medium select-none">
                  {(host.replace(/^www\./, '')[0] || '?').toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-[10px] text-content-muted font-mono shrink-0">[{i + 1}]</span>
                    <span className="truncate text-content-primary">{r.title}</span>
                    {host && (
                      <span className="shrink-0 text-[10px] text-content-muted truncate max-w-[40%]">
                        {host}
                      </span>
                    )}
                  </span>
                  {r.snippet && (
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-content-secondary line-clamp-2">
                      {r.snippet}
                    </span>
                  )}
                </span>
              </>
            )
            return clickable ? (
              <a
                key={r.url}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-1.5 rounded-md px-1 py-1 -mx-1 hover:bg-surface-subtle transition-colors"
              >
                {inner}
              </a>
            ) : (
              <div key={`${i}-${r.title}`} className="flex items-start gap-1.5 px-1 py-1 -mx-1">
                {inner}
              </div>
            )
          })}
        </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Memoized ToolCallCard —— tool part 的 output 一次性到达、之后引用稳定,
 * memo 保证正文流式重渲时不连带重渲卡片。
 */
export const ToolCallCard = memo(ToolCallCardInner)
