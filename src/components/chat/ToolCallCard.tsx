'use client'

import { memo, useState } from 'react'
import { Brain, Check, ChevronDown, Globe, Loader2, Search, Settings2, TriangleAlert, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UIMessage } from 'ai'
import { ClarifyCard } from './ClarifyCard'
import { GenerateMaskCard } from './GenerateMaskCard'
import { CLARIFY_TOOL_NAME } from '@/lib/ai/clarify'
import { MASK_TOOL_NAME } from '@/lib/ai/mask-tool'
import { SETTINGS_TOOL_NAME } from '@/lib/ai/settings-tool'
import { MEMORY_TOOL_NAME } from '@/lib/ai/memory-tool'
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

/** ToolCallCard 渲染入参:除工具视图外,携带澄清卡片的交互回调与已答状态 */
interface ToolCallCardProps {
  view: ToolCallView
  /** ask_clarification:该消息之后是否已有 user 消息(已答则卡片锁定) */
  clarifyAnswered?: boolean
  /** ask_clarification:提交回答文本(走 sendMessage 全链路);缺省则卡片只读 */
  onClarifySubmit?: (answersText: string) => void
}

function ToolCallCardInner({ view, clarifyAnswered, onClarifySubmit }: ToolCallCardProps) {
  // hooks 置顶(web_search 的展开状态),避免条件 return 造成 hooks 顺序不稳定
  const [manual, setManual] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // 澄清提问:专用交互卡片(问题+选项点选),不进通用工具卡分支
  if (view.tool === CLARIFY_TOOL_NAME) {
    return <ClarifyCard view={view} answered={clarifyAnswered ?? false} onSubmit={onClarifySubmit} />
  }

  // 面具工坊:专用交互卡片(草稿预览+一键添加),不进通用工具卡分支
  if (view.tool === MASK_TOOL_NAME) {
    return <GenerateMaskCard view={view} />
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

  // 用户手动切换后交还控制权,不再自动变化。
  const autoOpen = view.state !== 'output-available'
  const isOpen = manual ? expanded : autoOpen
  const toggle = () => {
    setManual(true)
    setExpanded((v) => !v)
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
