'use client'

import { useState, useCallback, useRef, useEffect, useMemo, KeyboardEvent, memo, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bot,
  Copy,
  Check,
  RotateCw,
  Pencil,
  X,
  ChevronDown,
  Brain,
  FileText,
  FileType,
  Code2,
  Reply,
  ExternalLink,
  BookmarkPlus,
  CheckCircle2,
  Layers,
  History,
  Loader2,
} from 'lucide-react'
import { cn, splitReasoningTail } from '@/lib/utils'
import { useTypewriter } from '@/lib/useTypewriter'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ChartCard } from './ChartCard'
import { ToolCallCard, extractToolCallViews } from './ToolCallCard'
import { useSingleFlight } from '@/hooks/useSingleFlight'
import { toast } from '@/lib/toast'
import { useChatStore } from '@/store/chat-store'
import { useContextMenuStore, type ContextMenuItem } from '@/store/contextMenuStore'
import type { UIMessage } from 'ai'
import type { Attachment } from '@/lib/attachment-types'

// 长会话性能优化:视口外的消息跳过排版与绘制(DOM 保留,复制/滚动定位等交互不受影响)。
// containIntrinsicSize 的 'auto' 让浏览器记住真实高度,首渲前用 180px 估算占位。
const MSG_WRAPPER_STYLE: CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 180px',
}

/**
 * 结构化 UI 提示的子类型集合 —— MessageBubble 据此分发到不同渲染分支。
 * 写入规则：仅后端写入；前端按 kind 决定是否走专用卡片组件。
 */
export type MessageMetadata =
  | {
      kind: 'branch_summary'
      version: 1
      /** 来源对话 id,用于"跳回源对话"按钮 */
      sourceId: string
      /** 来源对话标题,用于卡片头部的面包屑显示 */
      sourceTitle?: string
      /** 分支创建时间 ISO 字符串 */
      branchedAt?: string
    }
  | {
      kind: 'chart'
      version: 1
      /** 图表数据 */
      chart: {
        type: 'bar' | 'line' | 'pie' | 'area' | 'scatter'
        data: Record<string, unknown>[]
        title?: string
        xKey?: string
        yKey?: string
        nameKey?: string
        valueKey?: string
        colors?: string[]
      }
    }
  | { kind: string; version?: number; [k: string]: unknown } // 兜底:未来 kind 直接返回 null,走默认渲染

/** 从 UIMessage 取出 metadata,未知结构兜底为 null */
export function getMessageMetadata(msg: UIMessage): MessageMetadata | null {
  const raw = (msg as UIMessage & { metadata?: unknown }).metadata
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as MessageMetadata
}

/** UIMessage 上挂载的附件扩展字段(历史加载与发送后注入) */
export type UIMessageWithAttachments = UIMessage & {
  attachments?: Attachment[]
  /** 历史消息的创建时间(数据库) */
  createdAt?: Date
  /** token 消耗统计 */
  tokens?: { prompt: number; completion: number }
  /** 结构化 UI 提示(由后端写入,见 MessageMetadata) */
  metadata?: MessageMetadata | null
}

/**
 * 上下文摘要卡片 —— 在「在新对话继续」触发的分支对话顶部展示压缩后的对话摘要。
 *
 * 设计目标:
 * - 与普通 system 文本消息视觉上明确区分(卡片样式 + 顶部色条)
 * - 默认折叠,只露头标题栏;展开后显示 Markdown 渲染的摘要正文
 * - 头部显示来源对话标题 + 跳回按钮,方便用户回查原文
 * - 复制按钮一键复制 Markdown 原文
 *
 * 只在 role==='system' 且 metadata.kind==='branch_summary' 时使用,
 * 不会乱触发 —— system 消息只有我们的后端会写。
 */
interface SummaryCardProps {
  /** 摘要 Markdown 原文(不含首行 ## 标题,首行由卡片头部替代) */
  content: string
  /** 后端写入的 metadata */
  meta: Extract<MessageMetadata, { kind: 'branch_summary' }>
}

function SummaryCardInner({ content, meta }: SummaryCardProps) {
  const router = useRouter()
  // 摘要卡片默认展开,让用户一进来就能看到上下文;
  // 折叠交给用户主动操作(内容多时省屏幕)
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)
  // 摘要卡片只在分支对话顶部出现,直接读当前会话 id 判断"跳回"是否要禁用
  const currentConversationId = useChatStore((s) => s.currentConversationId)

  // 来源对话 id 与当前 id 相同(用户自己从源对话跳进去看)
  // → 「跳回源对话」按钮禁用,避免无意义跳转
  const sameAsSource = !currentConversationId || currentConversationId === meta.sourceId

  const handleJumpBack = useCallback(() => {
    if (!meta.sourceId || sameAsSource) return
    router.push(`/chat/c/${meta.sourceId}`)
  }, [meta.sourceId, sameAsSource, router])

  const handleCopy = useCallback(() => {
    if (!navigator.clipboard?.writeText) {
      toast.error('当前浏览器不支持自动复制', { title: '复制失败' })
      return
    }
    navigator.clipboard.writeText(content)
      .then(() => {
        setCopied(true)
        toast.success('已复制摘要 Markdown', { title: '复制' })
        setTimeout(() => setCopied(false), 2000)
      })
      .catch((err) => {
        console.error('[SummaryCard] copy failed:', err)
        toast.error('复制失败', { title: '复制' })
      })
  }, [content])

  return (
    <div
      className={cn(
        'rounded-xl border border-line/70 bg-surface-subtle/60 overflow-hidden',
        'transition-colors hover:border-line'
      )}
      data-summary-card="true"
    >
      {/* 头部:左侧图标 + 标题 + 来源,右侧操作按钮组 */}
      <div
        className={cn(
          'flex items-center justify-between gap-2 px-3.5 py-2',
          'border-b border-line/60 bg-gradient-to-r from-accent/[0.06] via-accent/[0.03] to-transparent',
          // 折叠时去掉下边框,让卡片视觉上更紧凑
          !expanded && 'border-b-0'
        )}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Layers className="w-3.5 h-3.5 text-accent shrink-0" />
          <span className="text-xs font-semibold text-content-primary tracking-wide">
            上下文摘要
          </span>
          {meta.sourceTitle && (
            <>
              <span className="text-content-muted/50 text-xs shrink-0">·</span>
              <button
                type="button"
                onClick={handleJumpBack}
                disabled={sameAsSource}
                title={sameAsSource ? '当前已在源对话' : `跳回源对话:${meta.sourceTitle}`}
                className={cn(
                  'group inline-flex items-center gap-1 min-w-0 text-xs text-content-secondary',
                  'hover:text-accent transition-colors',
                  sameAsSource && 'opacity-60 cursor-default hover:text-content-secondary'
                )}
              >
                <span className="truncate max-w-[200px]">来自《{meta.sourceTitle}》</span>
                {!sameAsSource && (
                  <ExternalLink className="w-3 h-3 shrink-0 opacity-60 group-hover:opacity-100" />
                )}
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded-md text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors"
            title="复制 Markdown"
            aria-label="复制摘要"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="p-1 rounded-md text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors"
            title={expanded ? '折叠' : '展开'}
            aria-label={expanded ? '折叠摘要' : '展开摘要'}
            aria-expanded={expanded}
          >
            <ChevronDown
              className={cn('w-3.5 h-3.5 transition-transform', !expanded && '-rotate-90')}
            />
          </button>
        </div>
      </div>

      {/* 折叠态:不渲染内容,节省屏幕 */}
      {expanded && (
        <div className="px-3.5 py-3 text-xs leading-relaxed">
          <MarkdownRenderer content={content} messageId="summary-card" rich />
        </div>
      )}
    </div>
  )
}

const SummaryCard = memo(SummaryCardInner)

/** 格式化完整日期时间:YYYY-MM-DD HH:MM */
function formatFullDateTime(date: Date): string {
  const y = date.getFullYear()
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  const h = date.getHours().toString().padStart(2, '0')
  const min = date.getMinutes().toString().padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${min}`
}

/** 格式化 token 数量 */
function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toString()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** C 分支轻量版: 归档旧版本消息(回看端点返回结构) */
interface ArchivedMessage {
  id: string
  role: string
  content: string
  createdAt?: string
}

interface MessageBubbleProps {
  message: UIMessage
  isStreaming?: boolean
  isLastAssistant?: boolean
  canRegenerate?: boolean
  onRegenerate?: () => void
  canEdit?: boolean
  onEdit?: (messageId: string, newText: string) => void
  /** 键盘导航选中状态 */
  isFocused?: boolean
  /** 外层 ref callback，用于滚动到视野 */
  wrapperRef?: (el: HTMLDivElement | null) => void
  /** 前一条用户消息的文本(存错题本时,assistant 消息用它配对题干;null/undefined = 无) */
  prevUserContent?: string | null
  /** 澄清问答:提交回答文本(透传给 ToolCallCard 内的 ClarifyCard) */
  onClarifySubmit?: (answersText: string) => void
  /** local_file:决策(批准/拒绝),透传给 ToolCallCard 内的 LocalFileCard */
  onLocalFileDecision?: (
    toolCallId: string,
    path: string,
    approved: boolean,
    decision: import('@/lib/ai/local-file-tool').LocalFileDecision
  ) => void
  /** 澄清问答:该消息之后是否已有 user 消息(已答则卡片锁定为摘要行) */
  clarifyAnswered?: boolean
}

function MessageBubbleInner({
  message,
  isStreaming,
  isLastAssistant,
  canRegenerate,
  onRegenerate,
  canEdit,
  onEdit,
  isFocused,
  wrapperRef,
  prevUserContent,
  onClarifySubmit,
  onLocalFileDecision,
  clarifyAnswered,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isSystem = message.role === 'system'

  // 结构化 UI 提示: system + metadata.kind === 'branch_summary' 走摘要卡片分支
  // 仅后端会写 system 消息,所以这个分支只在新创建的分支对话顶部触发
  const messageMeta = getMessageMetadata(message)
  const isSummaryCard =
    isSystem && messageMeta?.kind === 'branch_summary' && !!messageMeta.sourceId

  // C 分支轻量版: 编辑产生的新消息带 editedFrom(指向被编辑消息),
  // 据此提供"查看历史版本"回看入口(旧版本链存在服务端归档表中)
  const editedFrom =
    isUser &&
    messageMeta &&
    typeof (messageMeta as { editedFrom?: unknown }).editedFrom === 'string'
      ? ((messageMeta as { editedFrom?: unknown }).editedFrom as string)
      : null
  // 卡片用的"摘要正文":剥掉首行 `## 来自上文的上下文摘要...`,
  // 因为卡片头部已经有自己的标题,避免重复
  const summaryContent = useMemo(() => {
    if (!isSummaryCard) return ''
    const lines = message.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('')
      .split('\n')
    // 找到第一个以 `## ` 开头的行后,从下一行开始切
    const idx = lines.findIndex((l) => /^##\s+/.test(l))
    if (idx === -1) return lines.join('\n').trim()
    return lines.slice(idx + 1).join('\n').trim()
  }, [isSummaryCard, message.parts])
  const summaryMeta = messageMeta && isSummaryCard
    ? (messageMeta as Extract<MessageMetadata, { kind: 'branch_summary' }>)
    : null

  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  // 思考框展开状态: null=未手动干预(自动行为接管),true/false=用户点过折叠按钮后的选择
  const [userShowReasoning, setUserShowReasoning] = useState<boolean | null>(null)
  const autoCollapseReasoning = useChatStore((s) => s.autoCollapseReasoning)
  const [copyMenuOpen, setCopyMenuOpen] = useState(false)
  const copyMenuRef = useRef<HTMLDivElement>(null)
  // 复制菜单的智能定位状态。打开菜单后,根据可用空间自动 choose 上/下/左/右
  const copyMenuPos = useRef<'below-right' | 'below-left' | 'above-right' | 'above-left'>('below-left')
  /** HTML 复制源: 点击复制 HTML 时按需创建, 用完即销毁.
   *  原实现是 MessageBubble render 内常驻一个 hidden MarkdownRenderer,
   *  与主显示区并行渲染, 流式期间双倍重渲染 / 双倍 DOM diff, 是死循环源头之一。
   *  改造: 不再常驻. 点击复制 HTML 时挂载到 portal, 拿到 innerHTML 立即卸载。
   */
  const [htmlMirrorActive, setHtmlMirrorActive] = useState(false)
  const htmlMirrorRef = useRef<HTMLDivElement>(null)
  const htmlMirrorResolveRef = useRef<((html: string | null) => void) | null>(null)

  // ── 旧版本回看(C 分支轻量版)────────────────────────
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [archivedLoading, setArchivedLoading] = useState(false)
  const [archivedMessages, setArchivedMessages] = useState<ArchivedMessage[] | null>(null)

  const toggleArchived = useCallback(() => {
    if (archivedOpen) {
      setArchivedOpen(false)
      return
    }
    setArchivedOpen(true)
    if (archivedMessages || !editedFrom) return
    setArchivedLoading(true)
    fetch(`/api/conversations/${currentConversationId}/archived?rootId=${editedFrom}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => setArchivedMessages(Array.isArray(data?.messages) ? data.messages : []))
      .catch(() => {
        toast.error('历史版本加载失败', { title: '提示' })
        setArchivedOpen(false)
      })
      .finally(() => setArchivedLoading(false))
  }, [archivedOpen, archivedMessages, editedFrom, currentConversationId])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Extract reasoning parts from message (for deep thinking / reasoning models)
  const reasoningParts = message.parts.filter((p) => p.type === 'reasoning')
  const reasoningText = reasoningParts.map((p) => p.text).join('')
  const lastReasoningPart = reasoningParts[reasoningParts.length - 1] as { state?: string } | undefined
  const isReasoningStreaming = isStreaming && isAssistant && lastReasoningPart?.state === 'streaming'

  // 附件 (仅用户消息有)
  const attachments = (message as UIMessageWithAttachments).attachments ?? []

  // 时间戳和 token 统计
  const msgCreatedAt = (message as UIMessageWithAttachments).createdAt
  const msgTokens = (message as UIMessageWithAttachments).tokens
  const totalTokens = msgTokens ? msgTokens.prompt + msgTokens.completion : 0

  // Extract text from message parts
  const textParts = message.parts.filter((p) => p.type === 'text')
  const text = textParts.map((p) => p.text).join('')
  const lastPart = textParts[textParts.length - 1] as { state?: string } | undefined
  const isCurrentlyStreaming = isStreaming && isAssistant && lastPart?.state === 'streaming'
  const isWaitingForReasoning = isStreaming && isAssistant && !reasoningText && !text

  // 工具调用视图(联网搜索等):流式期间来自 message.parts,历史消息来自 metadata.toolCalls。
  // 渲染在 reasoning 与正文之间,时间线上与"模型先查资料后回答"的顺序一致。
  const toolCallViews = useMemo(
    () => (isAssistant ? extractToolCallViews(message) : []),
    [message, isAssistant]
  )

  // 兜底:模型偶发把全部内容(含最终答案)都放进 <think> 标签,导致正文为空。
  // 流式期间也尝试拆分(只要看到明确标记就立即切分),避免用户看到空白几秒到几十秒。
  // 用正则限定只切分明确标记,避免误切普通的"答案"二字。
  const streamingFallbackMarker =
    /(?:【答案】|【最终答案】|【最终结论】|最终结论[：:]|最终答案[：:]|所以答案是[：:]|所以结论是[：:]|回答如下[：:]|回复如下[：:]|综上[，:]?|总结一下[：:]|总结[：:]|Final answer[：:]|Final Answer[：:]|So the answer is[：:])\s*[\s\S]{0,2000}$/
  const needsBodyFallback =
    !text.trim() &&
    reasoningText.trim() !== '' &&
    (!isStreaming || streamingFallbackMarker.test(reasoningText))
  const bodySplit = needsBodyFallback ? splitReasoningTail(reasoningText) : null
  const bodyText = bodySplit ? bodySplit.tail : text

  // 存错题本:用户消息存题干;assistant 消息配对存(prevUserContent 为题干,自身为解析)
  const [studySaveState, setStudySaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const handleSaveToStudy = useCallback(async () => {
    if (studySaveState !== 'idle') return
    const questionText = isUser ? bodyText : (prevUserContent ?? '')
    const analysisText = isAssistant ? bodyText : ''
    if (!questionText.trim() && !analysisText.trim()) {
      toast.error('未找到可保存的题干', { title: '错题本' })
      return
    }
    setStudySaveState('saving')
    try {
      const res = await fetch('/api/study/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceMessageId: message.id, questionText, analysisText }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setStudySaveState('saved')
      toast.success('已存入错题本', { title: '错题本' })
    } catch (err) {
      console.error('[MessageBubble] save to study failed:', err)
      setStudySaveState('idle')
      toast.error('存入失败,请重试', { title: '错题本' })
    }
  }, [studySaveState, isUser, isAssistant, bodyText, prevUserContent, message.id])
  const displayReasoningText = bodySplit ? bodySplit.head : reasoningText

  // 思考框自动折叠(设置中可关):思考进行中默认展开,"思考完毕"自动收起让视野回到正文。
  // 完毕判定用 isThinkingActive(生成中且正文未出现)而非 reasoning part 的 state:
  // 流式恢复轮询构造的快照 parts 恒为 state:'done',用 state 判定会把还在思考的消息误折叠。
  // 用户手动点过按钮后以用户选择为准,新一轮思考开始时重置回自动接管。
  const isThinkingActive = Boolean(isAssistant && isStreaming && !bodyText.trim())
  // 思考中→展开;完毕(正文开始/生成结束/历史消息)→折叠成标题条;开关关闭则始终展开(旧行为)
  const showReasoning = userShowReasoning ?? (autoCollapseReasoning ? isThinkingActive : true)
  const prevThinkingActiveRef = useRef(false)
  useEffect(() => {
    if (isThinkingActive && !prevThinkingActiveRef.current) {
      setUserShowReasoning(null)
    }
    prevThinkingActiveRef.current = isThinkingActive
  }, [isThinkingActive])

  // Typewriter effect: only for live streaming, not for historical messages
  // Skip typewriter when message is already complete (streaming ended) to avoid
  // performance issues with long messages on page refresh
  const { displayText, isTyping } = useTypewriter(
    bodyText,
    Boolean(isAssistant && isCurrentlyStreaming) // Only enable during active stream
  )

  // Show cursor while AI is streaming OR typewriter is still catching up
  const showCursor = isCurrentlyStreaming || isTyping

  // 操作按钮始终可用 —— 只要消息有内容就显示。
  // 之前用 !isCurrentlyStreaming && !isTyping 把按钮藏到流式+打字机追完,
  // 用户得等 1-5 秒才能复制。重生成/停止也同理。
  const showActions = isStreaming !== undefined && bodyText.length > 0

  // Auto-focus and select when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
      // Auto-resize to fit content
      const ta = textareaRef.current
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
    }
  }, [isEditing])

  // Reset edit value when entering edit mode
  // beginEdit 是无事件版本:右键菜单项也要进编辑态(菜单里拿不到原 MouseEvent)
  const beginEdit = useCallback(() => {
    setEditValue(text)
    setIsEditing(true)
  }, [text])

  const startEditing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    beginEdit()
  }, [beginEdit])

  const cancelEditing = useCallback(() => {
    setEditValue('')
    setIsEditing(false)
  }, [])

  const commitEdit = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== text && onEdit) {
      onEdit(message.id, trimmed)
    }
    setIsEditing(false)
  }, [editValue, text, onEdit, message.id])

  const handleEditKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      commitEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEditing()
    }
  }, [commitEdit, cancelEditing])

  const handleCopy = useCallback(() => {
    // 检查 Clipboard API 可用性(非 https / 旧浏览器会失败)
    if (!navigator.clipboard?.writeText) {
      toast.error('当前浏览器不支持自动复制,请手动选择文本', { title: '复制失败' })
      return
    }
    navigator.clipboard.writeText(bodyText)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch((err) => {
        console.error('Failed to copy:', err)
        toast.error('复制失败,请手动选择文本', { title: '复制' })
      })
  }, [bodyText])

  const handleCopyDebounced = useSingleFlight(handleCopy, [bodyText])

  /**
   * 复制为 Markdown:模型输出本身就是 Markdown 源码,直接写入剪贴板即可
   */
  const handleCopyMarkdown = useCallback(() => {
    if (!navigator.clipboard?.writeText) {
      toast.error('当前浏览器不支持自动复制', { title: '复制失败' })
      return
    }
    navigator.clipboard.writeText(bodyText)
      .then(() => {
        toast.success('已复制为 Markdown', { title: '复制' })
        setCopyMenuOpen(false)
      })
      .catch((err) => {
        console.error('Failed to copy as markdown:', err)
        toast.error('复制失败', { title: '复制' })
      })
  }, [bodyText])

  /**
   * 复制为 HTML:从隐藏镜像 div 读取渲染后的 outerHTML,套一层 inline 样式
   * 让粘贴到笔记软件(Notion / 语雀 / 飞书等)时样式尽量保留
   *
   * 按需挂载: 用 setState 临时挂一个 hidden MarkdownRenderer, 等 ref 回调拿到 DOM
   * 后再读 innerHTML, 立刻卸载。整个生命周期只持续一次 commit, 不参与流式重渲染循环。
   */
  const handleCopyHtml = useCallback(() => {
    if (!navigator.clipboard?.write) {
      toast.error('当前浏览器不支持富文本复制,请改用纯文本或 Markdown', { title: '复制失败' })
      return
    }
    if (!bodyText.trim()) {
      toast.error('没有可复制的内容', { title: '复制失败' })
      return
    }
    // 用 Promise + ref 回调等 React commit 后立刻读 DOM
    setHtmlMirrorActive(true)
    htmlMirrorResolveRef.current = null
    requestAnimationFrame(() => {
      const node = htmlMirrorRef.current
      if (!node) {
        setHtmlMirrorActive(false)
        toast.error('HTML 渲染尚未就绪,请稍后再试', { title: '复制失败' })
        return
      }
      const html = node.innerHTML
      setHtmlMirrorActive(false)
      if (!html || !html.trim()) {
        toast.error('没有可复制的内容', { title: '复制失败' })
        return
      }
      // ClipboardItem 写入富文本 + 纯文本双格式,粘贴到支持的应用里走富文本,其他应用走纯文本
      const blobHtml = new Blob([html], { type: 'text/html' })
      const blobText = new Blob([bodyText], { type: 'text/plain' })
      const item = new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })
      navigator.clipboard.write([item])
        .then(() => {
          toast.success('已复制为 HTML', { title: '复制' })
          setCopyMenuOpen(false)
        })
        .catch((err) => {
          console.error('Failed to copy as HTML:', err)
          toast.error('富文本复制失败,已降级为纯文本', { title: '复制' })
          navigator.clipboard.writeText(bodyText).catch(() => {})
        })
    })
  }, [bodyText])

  // 下拉菜单的外部点击关闭
  // 用 mousedown + click 双确认 + 跳过刚打开的当次事件(避免菜单闪烁)
  useEffect(() => {
    if (!copyMenuOpen) return
    const openedAt = Date.now()
    function handleOutside(e: MouseEvent) {
      // 点的是同一个 microtask 内的自己 → 忽略(防止刚打开就被自己关掉)
      if (Date.now() - openedAt < 50) return
      if (
        copyMenuRef.current &&
        !copyMenuRef.current.contains(e.target as Node)
      ) {
        setCopyMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('click', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('click', handleOutside)
    }
  }, [copyMenuOpen])

  // 打开复制菜单后,根据可用空间智能 choose 弹出方向,
  // 避免菜单画到屏幕外(尤其移动端 / 窄屏)。预算后不需重测,滚动时再重测。
  useEffect(() => {
    if (!copyMenuOpen) return
    const measure = () => {
      const menu = copyMenuRef.current
      if (!menu) return
      const wrapper = document.querySelector(`[data-message-id="${message.id}"]`) as HTMLElement | null
      if (!wrapper) return
      const wrapperRect = wrapper.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const viewportW = window.innerWidth
      const viewportH = window.innerHeight
      const gap = 4

      // 方向选择:
      //   below = 菜单显示在按钮下方(top-full + mt-1)
      //   above = 菜单显示在按钮上方(bottom-full + mb-1)
      //   right/left = 菜单相对按钮的左右对齐
      const fitsBelow = wrapperRect.bottom + menuRect.height + gap < viewportH
      const fitsAbove = wrapperRect.top - menuRect.height - gap > 0
      const fitsRight = wrapperRect.right + menuRect.width < viewportW
      const fitsLeft = wrapperRect.left - menuRect.width > 0

      let pos: 'below-right' | 'below-left' | 'above-right' | 'above-left' = 'below-left'
      // 优先选择"装得下"的组合
      if (fitsBelow && fitsRight) pos = 'below-right'
      else if (fitsBelow && fitsLeft) pos = 'below-left'
      else if (fitsAbove && fitsRight) pos = 'above-right'
      else if (fitsAbove && fitsLeft) pos = 'above-left'
      else if (fitsBelow) pos = fitsRight ? 'below-right' : 'below-left'
      else pos = fitsAbove ? (fitsRight ? 'above-right' : 'above-left') : pos
      copyMenuPos.current = pos
      // 用 data-attr 配合 CSS 选择器,避免 React 状态污染
      menu.setAttribute('data-pos', pos)
    }
    // 给浏览器一帧渲染时间再测
    const raf = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [copyMenuOpen, message.id])

  const handleRegenerateDebounced = useSingleFlight(() => {
    if (onRegenerate) {
      onRegenerate()
    }
  }, [onRegenerate])

  const startEditingDebounced = useSingleFlight(startEditing, [text])

  // ── 右键菜单:把操作栏的 hover 按钮集合升格为右键菜单(桌面端习惯) ──
  // 菜单项全部复用现有 handlers,不新增 props → 无需改 memo 比较函数。
  // 无可用项时(如空正文)不 preventDefault,保留浏览器默认菜单。
  const handleMessageContextMenu = useCallback((e: React.MouseEvent) => {
    const canCopy = bodyText.length > 0
    const candidates: (ContextMenuItem | false | undefined)[] = [
      canCopy && {
        id: 'copy',
        label: '复制',
        icon: <Copy className="w-3.5 h-3.5" />,
        submenu: [
          { id: 'copy-text', label: '纯文本', icon: <FileText className="w-3.5 h-3.5" />, onSelect: handleCopy },
          { id: 'copy-md', label: 'Markdown', icon: <Code2 className="w-3.5 h-3.5" />, onSelect: handleCopyMarkdown },
          { id: 'copy-html', label: 'HTML（带样式）', icon: <FileType className="w-3.5 h-3.5" />, onSelect: handleCopyHtml },
        ],
      },
      isUser && canEdit && onEdit && {
        id: 'edit',
        label: '编辑',
        icon: <Pencil className="w-3.5 h-3.5" />,
        onSelect: beginEdit,
      },
      isAssistant && isLastAssistant && canRegenerate && onRegenerate && {
        id: 'regenerate',
        label: '重新生成',
        icon: <RotateCw className="w-3.5 h-3.5" />,
        onSelect: handleRegenerateDebounced,
      },
      canCopy && {
        id: 'reply',
        label: '引用回复',
        icon: <Reply className="w-3.5 h-3.5" />,
        // 与操作栏「引用回复」按钮同一通路:setReplyingTo 由 ChatInput 消费
        onSelect: () => {
          const { setReplyingTo } = useChatStore.getState()
          setReplyingTo({
            id: message.id,
            role: message.role,
            text: bodyText.slice(0, 120),
          })
        },
      },
      !isStreaming && (isUser || isAssistant) && {
        id: 'study',
        label: studySaveState === 'saved' ? '已存入错题本' : '存入错题本',
        icon: studySaveState === 'saved' ? <CheckCircle2 className="w-3.5 h-3.5 text-accent" /> : <BookmarkPlus className="w-3.5 h-3.5" />,
        disabled: studySaveState !== 'idle',
        onSelect: handleSaveToStudy,
      },
    ]
    const items = candidates.filter((it): it is ContextMenuItem => !!it)
    if (!items.length) return
    e.preventDefault()
    const { openContextMenu } = useContextMenuStore.getState()
    openContextMenu({ x: e.clientX, y: e.clientY }, items)
  }, [
    bodyText, isUser, isAssistant, canEdit, onEdit, isLastAssistant, canRegenerate,
    onRegenerate, beginEdit, handleCopy, handleCopyMarkdown, handleCopyHtml,
    handleRegenerateDebounced, handleSaveToStudy, studySaveState, isStreaming,
    message.id, message.role,
  ])

  // 结构化摘要卡片分支 —— system + branch_summary metadata 走独立渲染
  // 整张卡片独占一行,不显示 AI 头像 / 操作按钮,视觉上与正常消息流明确区分
  if (isSummaryCard && summaryMeta) {
    return (
      <div
        ref={wrapperRef}
        style={MSG_WRAPPER_STYLE}
        data-message-id={message.id}
        className={cn(
          'flex justify-start px-4 py-2 transition-colors group relative',
          isFocused && 'bg-accent/5 border-l-2 border-l-accent'
        )}
      >
        <div className="min-w-0 flex-1 max-w-full">
          <SummaryCard content={summaryContent} meta={summaryMeta} />
        </div>
      </div>
    )
  }

  // Edit mode: inline textarea for user messages
  if (isUser && isEditing) {
    return (
      <div className="flex justify-end px-4 py-2">
        <div className="max-w-[80%] w-full">
          <div className="rounded-lg bg-accent rounded-br-sm overflow-hidden">
            <textarea
              ref={textareaRef}
              value={editValue}
              onChange={(e) => {
                setEditValue(e.target.value)
                // Auto-resize
                const ta = e.target
                ta.style.height = 'auto'
                ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
              }}
              onKeyDown={handleEditKeyDown}
              onBlur={commitEdit}
              rows={1}
              className="w-full resize-none bg-transparent text-sm leading-relaxed text-accent-foreground outline-none px-3 py-1.5 min-h-[24px] max-h-[200px]"
            />
          </div>
          <div className="flex items-center justify-end gap-1 mt-1">
            <button
              onMouseDown={(e) => { e.preventDefault(); cancelEditing() }}
              className="p-1 rounded-md text-content-muted hover:text-red-500 hover:bg-surface-subtle transition-colors"
              title="取消"
              aria-label="取消"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <button
              onMouseDown={(e) => { e.preventDefault(); commitEdit() }}
              className="p-1 rounded-md text-content-muted hover:text-green-500 hover:bg-surface-subtle transition-colors"
              title="确认"
              aria-label="确认"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={wrapperRef}
      style={MSG_WRAPPER_STYLE}
      data-message-id={message.id}
      onContextMenu={handleMessageContextMenu}
      className={cn(
        'flex gap-2.5 px-4 py-2 transition-colors group relative',
        isUser ? 'justify-end' : 'justify-start',
        isFocused && 'bg-accent/5 border-l-2 border-l-accent'
      )}
    >
      {/* Avatar - only for AI */}
      {!isUser && (
        <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-accent text-accent-foreground mt-0.5">
          <Bot className="w-3 h-3" />
        </div>
      )}

      {/* Message content */}
      <div className={cn('min-w-0 overflow-hidden', isUser ? 'max-w-[80%]' : 'flex-1 max-w-full')}>
        {isAssistant ? (
          <>
            {/* Reasoning / deep thinking section */}
            {/* 折叠态用胶囊条而非纯文字:之前折叠后只剩 11px 灰字,与隐藏无异,
                用户想回看生成过程时找不到入口;胶囊+“点击回看”文案明确可点 */}
            {displayReasoningText && (
              <div className="mb-2">
                <button
                  onClick={() => setUserShowReasoning(!showReasoning)}
                  title={showReasoning ? '点击折叠' : '点击展开思考过程'}
                  className={cn(
                    'transition-colors',
                    showReasoning
                      ? 'flex items-center gap-1.5 text-[11px] font-medium text-content-secondary hover:opacity-80'
                      : 'inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-subtle/70 px-2.5 py-1 text-[11px] text-content-secondary hover:text-content-primary hover:bg-surface-subtle'
                  )}
                >
                  <Brain className="w-3 h-3" />
                  <span>{showReasoning ? '思考过程' : '已深度思考 · 点击回看'}</span>
                  <ChevronDown className={cn('w-3 h-3 transition-transform', showReasoning ? '' : '-rotate-90')} />
                </button>
                {showReasoning && (
                  <div className="mt-1.5 pl-3 border-l-2 border-line-strong/60">
                    <p className="text-xs text-content-secondary whitespace-pre-wrap break-words leading-relaxed">
                      {displayReasoningText}
                      {isReasoningStreaming && (
                        <span className="inline-block w-1 h-3 ml-0.5 bg-accent animate-pulse align-middle" />
                      )}
                    </p>
                  </div>
                )}
              </div>
            )}
            {/* Main response */}
            {/* 工具调用卡片:联网搜索过程可视化(搜索中 spinner / 完成后来源列表) */}
            {toolCallViews.length > 0 && (
              <div className="mb-2 flex flex-col gap-1.5">
                {toolCallViews.map((v, i) => (
                  <ToolCallCard
                    key={v.toolCallId ?? `${v.tool}-${i}`}
                    view={v}
                    clarifyAnswered={clarifyAnswered}
                    onClarifySubmit={onClarifySubmit}
                    onLocalFileDecision={onLocalFileDecision}
                  />
                ))}
              </div>
            )}
            {displayText ? (
              <div className="relative text-sm text-content-primary leading-relaxed">
                <MarkdownRenderer content={displayText} messageId={message.id} rich={isAssistant && !showCursor} />
                {showCursor && (
                  <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-content-secondary animate-pulse align-middle" />
                )}
              </div>
            ) : isWaitingForReasoning ? (
              <div className="flex items-center gap-1.5 py-1">
                <Brain className="w-3 h-3 text-content-secondary animate-pulse" />
                <span className="text-xs text-content-muted">思考中...</span>
              </div>
            ) : isCurrentlyStreaming ? (
              <div className="flex items-center gap-1.5 py-1">
                <span className="w-2 h-2 bg-content-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-content-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-content-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            ) : null}

            {/* 图表渲染: metadata.kind === 'chart' 时显示图表卡片 */}
            {(() => {
              // 使用 useMemo 等效逻辑，但这里在 JSX 中直接计算
              // 仅在 metadata 存在且 kind === 'chart' 时才解析
              const raw = messageMeta as Record<string, unknown> | null
              if (!raw || raw.kind !== 'chart' || !raw.chart) return null
              const chart = raw.chart as Record<string, unknown>
              if (!Array.isArray(chart.data) || !chart.type) return null
              return (
                <div className="mt-3">
                  <ChartCard chart={chart as unknown as Parameters<typeof ChartCard>[0]['chart']} />
                </div>
              )
            })()}
          </>
        ) : (
          <div className="flex flex-col items-end gap-1.5">
            {/* 附件展示:图片缩略图(点击看大图) / 文件卡片 */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap justify-end gap-2">
                {attachments.map((att, idx) =>
                  att.type.startsWith('image/') ? (
                    <a
                      key={idx}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={att.name}
                      className="block overflow-hidden rounded-lg border border-line hover:opacity-90 transition-opacity"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={att.url}
                        alt={att.name}
                        className="max-h-40 max-w-[220px] object-contain bg-surface-muted"
                      />
                    </a>
                  ) : (
                    <a
                      key={idx}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={att.name}
                      className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-muted px-2 py-1.5 max-w-[180px] hover:bg-surface-subtle transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5 text-content-secondary shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-content-primary truncate">{att.name}</p>
                        <p className="text-[10px] text-content-muted">{formatSize(att.size)}</p>
                      </div>
                    </a>
                  )
                )}
              </div>
            )}
            <div className="rounded-lg bg-accent px-3 py-1.5 rounded-br-sm">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-accent-foreground">{text}</p>
            </div>
          </div>
        )}

        {/* C 分支轻量版: 编辑过的消息提供旧版本回看(仅 user 且有 editedFrom) */}
        {isUser && editedFrom && (
          <div className="mt-1 rounded-lg border border-line/50 bg-surface/60 p-2">
            <button
              onClick={toggleArchived}
              className="inline-flex items-center gap-1 text-[11px] text-content-muted hover:text-content-secondary transition-colors"
              aria-expanded={archivedOpen}
            >
              {archivedLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <History className="w-3 h-3" />
              )}
              <span>已编辑 · {archivedOpen ? '收起历史版本' : '查看历史版本'}</span>
              <ChevronDown className={cn('w-3 h-3 transition-transform', archivedOpen ? '' : '-rotate-90')} />
            </button>
            {archivedOpen && archivedMessages && archivedMessages.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {archivedMessages.map((m) => (
                  <div key={m.id} className="rounded-md bg-surface-muted/70 px-2 py-1.5">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-subtle/80 text-content-muted">
                        {m.role === 'user' ? '用户' : 'AI'}
                      </span>
                      {m.createdAt && (
                        <span className="text-[10px] text-content-muted/70">
                          {formatFullDateTime(new Date(m.createdAt))}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-content-secondary break-words leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {m.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action bar */}
        <div className={cn('flex items-center gap-0.5 mt-1', isUser ? 'justify-end' : 'justify-start')}>
          {/* 完整日期时间 + token:仅 assistant 消息永久显示 */}
          {isAssistant && msgCreatedAt && (
            <span className="text-[10px] text-content-muted/60 mr-2 select-none font-mono whitespace-nowrap">
              {formatFullDateTime(new Date(msgCreatedAt))}
              {totalTokens > 0 && (
                <span className="ml-2 text-content-muted/50">
                  · {formatTokens(totalTokens)} tokens
                </span>
              )}
            </span>
          )}
          {showActions && (
            <>
            {/* 复制按钮组:主按钮=纯文本,下拉=Markdown / HTML */}
            <div ref={copyMenuRef} className="relative inline-flex">
              <button
                onClick={handleCopyDebounced}
                className="p-1 rounded-md text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors active:scale-95 touch-manipulation"
                title="复制纯文本"
                aria-label="复制"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setCopyMenuOpen((v) => !v)
                }}
                className="p-1 rounded-md text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors active:scale-95 touch-manipulation"
                title="复制格式"
                aria-label="选择复制格式"
                aria-haspopup="menu"
                aria-expanded={copyMenuOpen}
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <ChevronDown className="w-3 h-3" />
              </button>
              {copyMenuOpen && (
                <div
                  role="menu"
                  // 菜单位置默认 below-left(桌面端常见);移动端 / 窄屏由 effect 测距后
  // 用 data-pos 改写定位(下方/上方 × 左/右),避免溢出屏幕
  className="copy-menu absolute z-30 top-full mt-1 right-0 sm:left-0 min-w-[140px] rounded-lg border border-line/60 bg-surface shadow-xl py-1 text-xs
                    [&[data-pos='below-right']]:top-full [&[data-pos='below-right']]:mt-1 [&[data-pos='below-right']]:right-0 [&[data-pos='below-right']]:left-auto
                    [&[data-pos='below-left']]:top-full [&[data-pos='below-left']]:mt-1 [&[data-pos='below-left']]:left-0 [&[data-pos='below-left']]:right-auto
                    [&[data-pos='above-right']]:top-auto [&[data-pos='above-right']]:bottom-full [&[data-pos='above-right']]:mb-1 [&[data-pos='above-right']]:right-0 [&[data-pos='above-right']]:left-auto
                    [&[data-pos='above-left']]:top-auto [&[data-pos='above-left']]:bottom-full [&[data-pos='above-left']]:mb-1 [&[data-pos='above-left']]:left-0 [&[data-pos='above-left']]:right-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    role="menuitem"
                    onClick={() => {
                      handleCopy()
                      setCopyMenuOpen(false)
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-surface-subtle text-content-secondary hover:text-content-primary text-left"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    纯文本
                  </button>
                  <button
                    role="menuitem"
                    onClick={handleCopyMarkdown}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-surface-subtle text-content-secondary hover:text-content-primary text-left"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    Markdown
                  </button>
                  <button
                    role="menuitem"
                    onClick={handleCopyHtml}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-surface-subtle text-content-secondary hover:text-content-primary text-left"
                  >
                    <FileType className="w-3.5 h-3.5" />
                    HTML（带样式）
                  </button>
                </div>
              )}
            </div>
            {isAssistant && isLastAssistant && canRegenerate && onRegenerate && (
              <button
                onClick={handleRegenerateDebounced}
                className="p-1 rounded-md text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors active:scale-95 touch-manipulation"
                title="重新生成"
                aria-label="重新生成"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
            )}
            {isUser && canEdit && onEdit && (
              <button
                onClick={startEditingDebounced}
                className="p-1 rounded-md text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors active:scale-95 touch-manipulation"
                title="编辑"
                aria-label="编辑"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {/* 回复按钮:所有消息都可引用回复 */}
            <button
              onClick={() => {
                const { setReplyingTo } = useChatStore.getState()
                setReplyingTo({
                  id: message.id,
                  role: message.role,
                  text: bodyText.slice(0, 120), // 截取前 120 字符作预览
                })
              }}
              className="p-1 rounded-md text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors active:scale-95 touch-manipulation"
              title="引用回复"
              aria-label="引用回复"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <Reply className="w-3.5 h-3.5" />
            </button>
            {/* 存错题本:流式结束才可点;已存过显示 ✓ */}
            {!isStreaming && (isUser || isAssistant) && (
              <button
                onClick={handleSaveToStudy}
                disabled={studySaveState === 'saving'}
                className="p-1 rounded-md text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors active:scale-95 touch-manipulation"
                title="存入错题本"
                aria-label="存入错题本"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                {studySaveState === 'saved' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-accent" />
                ) : (
                  <BookmarkPlus className="w-3.5 h-3.5" />
                )}
              </button>
            )}
            </>
          )}
        </div>
      </div>
      {/* HTML 复制源 —— 按需挂载, 用完即销毁。
          永远不在 render 主路径上常驻(那样会和主显示区的 MarkdownRenderer 一起
          被父组件重渲染, 流式期间双倍重渲染 → 死循环源头之一)。
          仅当用户点 "复制为 HTML" 时临时挂一帧, 拿到 innerHTML 后立即卸载。 */}
      {htmlMirrorActive && (
        <div
          ref={htmlMirrorRef}
          aria-hidden
          style={{
            position: 'absolute',
            left: '-99999px',
            top: 0,
            width: '600px',
            visibility: 'hidden',
            pointerEvents: 'none',
          }}
        >
          <MarkdownRenderer content={bodyText} messageId={message.id} rich />
        </div>
      )}
    </div>
  )
}

/**
 * 自定义 props 比较函数 —— 流式场景下避免无关重渲
 *
 * 关键点:
 * - message.id 不变 → 同一条消息
 * - message.parts 序列化字符串(strip text 后)变化 → 必须重渲(流式追加)
 * - message.role 不变 → 同角色
 * - isStreaming 变化 → 必须重渲(切换流式/静态视觉)
 * - isLastAssistant 变化 → 切换按钮可见性
 * - canRegenerate / canEdit: 派生自父级,变化即应重渲
 * - onRegenerate / onEdit: 由父级 useCallback 提供,引用稳定;若变化说明父级未优化,照旧重渲
 */
function areMessageBubblePropsEqual(
  prev: Readonly<MessageBubbleProps>,
  next: Readonly<MessageBubbleProps>
): boolean {
  if (prev.message.id !== next.message.id) return false
  if (prev.message.role !== next.message.role) return false
  if (prev.isStreaming !== next.isStreaming) return false
  if (prev.isLastAssistant !== next.isLastAssistant) return false
  if (prev.canRegenerate !== next.canRegenerate) return false
  if (prev.canEdit !== next.canEdit) return false
  if (prev.onRegenerate !== next.onRegenerate) return false
  if (prev.onEdit !== next.onEdit) return false
  if (prev.isFocused !== next.isFocused) return false
  if (prev.prevUserContent !== next.prevUserContent) return false
  // wrapperRef 不必比较(它只用来滚动,变化不影响渲染结果)

  // 附件挂载由异步 effect 注入(引用变化): 不比较会导致文件卡片永远不出现。
  // 引用相同直接跳过(url 唯一,长度+url 指纹足以覆盖增删场景)
  const paAtt = (prev.message as UIMessageWithAttachments).attachments
  const pbAtt = (next.message as UIMessageWithAttachments).attachments
  if (paAtt !== pbAtt) {
    if (!paAtt || !pbAtt || paAtt.length !== pbAtt.length) return false
    for (let i = 0; i < paAtt.length; i++) {
      if (paAtt[i].url !== pbAtt[i].url) return false
    }
  }

  // 关键: parts 的"形状指纹" —— 流式追加时 text 变化不算(我们靠 state 字段触发重渲)
  const pa = prev.message.parts
  const pb = next.message.parts
  if (pa.length !== pb.length) return false
  for (let i = 0; i < pa.length; i++) {
    const a = pa[i]
    const b = pb[i]
    if (a.type !== b.type) return false
    // 同一个 type 的 part,只在 state 切换或类型变化时重渲
    // text 字段变化由父级用 useState/useRef 收敛,这里跳过 text 直接比对
    const aState = (a as { state?: string }).state
    const bState = (b as { state?: string }).state
    if (aState !== bState) return false
  }
  return true
}

/**
 * Memoized MessageBubble —— 列表中其他消息变化时不会重渲
 * (流式场景: 只有"正在流式的那一条 + 最后一条助手"会频繁重渲)
 */
export const MessageBubble = memo(MessageBubbleInner, areMessageBubblePropsEqual)
