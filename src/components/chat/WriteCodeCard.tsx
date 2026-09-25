'use client'

/**
 * 代码文档卡片 —— 渲染 write_code 工具的代码文档创建结果。
 *
 * 三态（由 view.state 驱动）:
 * - 流式/待执行(input-streaming/input-available): 一行式「正在创建代码文档《标题》…」+ spinner
 * - 成功(output-available + ok): FileCode2 图标 + 标题 + 字符数/语言 + 「打开」按钮
 * - 失败(output-error 或 ok:false): 红色一行 + 错误信息
 *
 * 与 WriteDocCard 对称:文档已在工具 execute 时落库(CodeDoc 表),成功时自动
 * 滑出右侧代码编辑器面板(openCodePanel,store 层与写作画布互斥);「打开」按钮
 * 供历史消息回放/手动重开。
 */
import { memo, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useChatStore } from '@/store/chat-store'
import { FileCode2, Loader2 } from 'lucide-react'
import { queryKeys } from '@/lib/query/keys'
import { isWriteCodeOutput } from '@/lib/ai/write-code-tool'
import type { ToolCallView } from './ToolCallCard'

/**
 * 自动打开面板的跟踪集合:只有在本会话中经历过流式 pending 态的工具调用,
 * 完成时才自动滑出代码编辑器;历史回放(首挂即 output-available)不在集合里,永不触发。
 */
const pendingToolCalls = new Set<string>()
const autoOpenedToolCalls = new Set<string>()

interface WriteCodeCardProps {
  view: ToolCallView
}

function WriteCodeCardInner({ view }: WriteCodeCardProps) {
  const openCodePanel = useChatStore((s) => s.openCodePanel)
  const queryClient = useQueryClient()
  const rawTitle =
    !!view.input &&
    typeof view.input === 'object' &&
    typeof (view.input as { title?: unknown }).title === 'string'
      ? ((view.input as { title: string }).title as string).trim()
      : ''
  const parsed = isWriteCodeOutput(view.output) ? view.output : null
  // 判别收窄:parsed.ok 为 true 时才是成功形状(带 docId/title/language/charCount)
  const okOutput = parsed && parsed.ok ? parsed : null
  const failed = view.state === 'output-error' || (parsed !== null && !parsed.ok)
  const message =
    view.state === 'output-error'
      ? view.errorText || '代码文档创建失败'
      : parsed && !parsed.ok
        ? parsed.message
        : ''

  // 自动打开:刚经历流式 pending 的工具成功完成后,直接滑出代码编辑器(与写作画布同款)
  useEffect(() => {
    const id = view.toolCallId
    if (!id) return
    if (view.state === 'input-streaming' || view.state === 'input-available') {
      pendingToolCalls.add(id)
      return
    }
    if (view.state !== 'output-available' && view.state !== 'output-error') return
    // 本会话内见过 pending 态且首次完成;历史回放/重复完成均跳过
    if (!pendingToolCalls.delete(id)) return
    if (view.state !== 'output-available' || !okOutput || autoOpenedToolCalls.has(id)) return
    autoOpenedToolCalls.add(id)
    // 左栏列表可能正命中 30s 缓存:失效让新文档即时出现在列表里。
    // 键含 conversationId(卡片不知会话上下文),按 code.list 前缀匹配全失效
    queryClient.invalidateQueries({ queryKey: [...queryKeys.all, 'code', 'list'] })
    openCodePanel(okOutput.docId)
  }, [view.state, view.toolCallId, okOutput, openCodePanel, queryClient])

  if (failed) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-500 dark:text-red-400">
        <FileCode2 className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0 truncate">代码文档创建失败:{message}</span>
      </div>
    )
  }

  if (!okOutput) {
    // 流式/待执行:参数(含长代码)还在生成
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-line bg-surface-muted/50 text-xs text-content-secondary">
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-accent" />
        <span className="min-w-0 truncate">
          正在创建代码文档{rawTitle ? `《${rawTitle}》` : ''}…
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-line bg-surface-muted/50">
      <div className="shrink-0 w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
        <FileCode2 className="w-4 h-4 text-accent" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-content-primary truncate">{okOutput.title}</div>
        <div className="text-[10px] text-content-muted mt-0.5 truncate">
          {okOutput.charCount} 字符 · {okOutput.language}
        </div>
      </div>
      <button
        type="button"
        title="在右侧代码编辑器中打开"
        onClick={() => openCodePanel(okOutput.docId)}
        className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium
          bg-accent text-accent-foreground hover:bg-accent/90 active:scale-95 transition-all"
      >
        <FileCode2 className="w-3.5 h-3.5" />
        打开
      </button>
    </div>
  )
}

export const WriteCodeCard = memo(WriteCodeCardInner)
