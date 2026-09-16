'use client'

import { memo, useState } from 'react'
import { ChevronDown, Globe, Loader2, Search, TriangleAlert, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UIMessage } from 'ai'

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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function ToolCallCardInner({ view }: { view: ToolCallView }) {
  // 状态驱动展开:搜索中默认展开(填补等待时间的信息空白),完成后自动收起为摘要行;
  // 用户手动切换后交还控制权,不再自动变化。
  const [manual, setManual] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const autoOpen = view.state !== 'output-available'
  const isOpen = manual ? expanded : autoOpen
  const toggle = () => {
    setManual(true)
    setExpanded((v) => !v)
  }

  // ---- 未知工具兜底 ----
  if (view.tool !== 'web_search') {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-line/60 bg-surface-muted px-2.5 py-1.5 text-xs text-content-secondary">
        <Wrench className="w-3.5 h-3.5 shrink-0 text-content-muted" />
        <span>调用了 {view.tool}</span>
        {view.state === 'output-error' && (
          <TriangleAlert className="w-3.5 h-3.5 shrink-0 text-red-500" />
        )}
      </div>
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

      {isOpen && (
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
      )}
    </div>
  )
}

/**
 * Memoized ToolCallCard —— tool part 的 output 一次性到达、之后引用稳定,
 * memo 保证正文流式重渲时不连带重渲卡片。
 */
export const ToolCallCard = memo(ToolCallCardInner)
