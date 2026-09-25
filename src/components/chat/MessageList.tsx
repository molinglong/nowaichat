'use client'

import { useRef, useEffect, useMemo } from 'react'
import { Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MessageBubble } from './MessageBubble'
import { useChatStore } from '@/store/chat-store'
import type { UIMessage } from 'ai'

interface MessageListProps {
  messages: UIMessage[]
  isStreaming: boolean
  className?: string
  onRegenerate?: () => void
  onEditMessage?: (messageId: string, newText: string) => void
  /** 澄清问答:提交回答文本(通常接 ChatPanel 的 handleSend,复用排队/发送全链路) */
  onClarifySubmit?: (answersText: string) => void
  /** local_file:决策(批准/拒绝),透传给 ToolCallCard 内的 LocalFileCard */
  onLocalFileDecision?: (
    toolCallId: string,
    path: string,
    approved: boolean,
    decision: import('@/lib/ai/local-file-tool').LocalFileDecision
  ) => void
  /** local_file:在编辑器中打开,透传给 ToolCallCard 内的 LocalFileCard */
  onOpenEditor?: (path: string) => void
  /** 请求已提交但模型首 token 未到(useChat submitted 阶段)——列表末尾渲染"生成中"占位 */
  isPending?: boolean
}

export function MessageList({
  messages,
  isStreaming,
  isPending,
  className,
  onRegenerate,
  onEditMessage,
  onClarifySubmit,
  onLocalFileDecision,
  onOpenEditor,
}: MessageListProps) {
  // 键盘导航:收集每个消息的 ref,按 id 索引
  const messageRefsMap = useRef<Map<string, HTMLDivElement>>(new Map())
  const focusedMessageId = useChatStore((s) => s.focusedMessageId)
  const setFocusedMessageId = useChatStore((s) => s.setFocusedMessageId)

  // 跟随滚动的判定与执行已上移到 ChatPanel(那里持有滚动容器 DOM):
  // 用户向上滚动即脱离跟随、可自由回看历史,滚回底部或点"回到底部"按钮恢复跟随。

  // 收敛 lastAssistantIndex —— messages 数组变化时只有这一处需要重算
  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i
    }
    return -1
  }, [messages])

  // canRegenerate / canEdit 收敛成常量,避免每次渲染创建新值
  const canRegenerateAll = !isStreaming && !!onRegenerate
  const canEditAll = !isStreaming && !!onEditMessage

  // 键盘导航(j/k): 仅在未聚焦 input 时触发,流式期间禁用
  useEffect(() => {
    // 流式期间禁用键盘导航,避免选中半截生成中的消息
    if (isStreaming || messages.length === 0) return

    function handleKeyDown(e: KeyboardEvent) {
      // 如果焦点在输入框/textarea/contenteditable,不拦截
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      const currentIndex = focusedMessageId
        ? messages.findIndex((m) => m.id === focusedMessageId)
        : -1

      if (e.key === 'j' || e.key === 'J') {
        // 下一条
        e.preventDefault()
        const nextIndex = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, messages.length - 1)
        const nextId = messages[nextIndex]?.id
        if (nextId) {
          setFocusedMessageId(nextId)
          // 滚动到视野
          const el = messageRefsMap.current.get(nextId)
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          }
        }
      } else if (e.key === 'k' || e.key === 'K') {
        // 上一条
        e.preventDefault()
        const prevIndex = currentIndex === -1 ? messages.length - 1 : Math.max(currentIndex - 1, 0)
        const prevId = messages[prevIndex]?.id
        if (prevId) {
          setFocusedMessageId(prevId)
          const el = messageRefsMap.current.get(prevId)
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          }
        }
      } else if (e.key === 'Enter' && focusedMessageId) {
        // 选中状态下 Enter → 快捷复制(触发 Copy 按钮)
        e.preventDefault()
        const el = messageRefsMap.current.get(focusedMessageId)
        if (el) {
          // 找到这条消息内的第一个复制按钮
          const copyBtn = el.querySelector<HTMLButtonElement>('button[aria-label="复制"]')
          copyBtn?.click()
        }
      } else if (e.key === 'Escape' && focusedMessageId) {
        // Esc 清除选中
        e.preventDefault()
        setFocusedMessageId(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [messages, isStreaming, focusedMessageId, setFocusedMessageId])

  // 每条消息对应的"前一条用户消息文本"(存错题本时,assistant 消息用它配对题干)
  const prevUserContentById = useMemo(() => {
    const map = new Map<string, string | null>()
    let last: string | null = null
    for (const msg of messages) {
      map.set(msg.id, last)
      if (msg.role === 'user') {
        const t = msg.parts
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('\n')
          .trim()
        if (t) last = t
      }
    }
    return map
  }, [messages])

  // 澄清问答"已答"判定:该 assistant 消息之后存在任意 user 消息
  // (无论用户是点选卡片提交还是直接打字,都视为已回答)
  const answeredAssistantIds = useMemo(() => {
    const set = new Set<string>()
    let seenUser = false
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === 'user') seenUser = true
      else if (msg.role === 'assistant' && seenUser) set.add(msg.id)
    }
    return set
  }, [messages])

  return (
    <div className={cn('w-full min-h-full overflow-x-hidden', className)}>
      <div className="max-w-2xl mx-auto overflow-x-hidden">
        {messages.map((message, index) => {
          const isFocused = message.id === focusedMessageId
          return (
            <MessageBubble
              key={message.id}
              message={message}
              prevUserContent={prevUserContentById.get(message.id)}
              isStreaming={isStreaming}
              isLastAssistant={index === lastAssistantIndex}
              canRegenerate={canRegenerateAll}
              onRegenerate={onRegenerate}
              canEdit={canEditAll}
              onEdit={onEditMessage}
              onClarifySubmit={onClarifySubmit}
              onLocalFileDecision={onLocalFileDecision}
              onOpenEditor={onOpenEditor}
              clarifyAnswered={answeredAssistantIds.has(message.id)}
              isFocused={isFocused}
              wrapperRef={(el) => {
                if (el) {
                  messageRefsMap.current.set(message.id, el)
                } else {
                  messageRefsMap.current.delete(message.id)
                }
              }}
            />
          )
        })}

        {/* submitted 占位: useChat 在模型首个 chunk 前不创建 assistant 消息,
            长 prompt 预填充期列表会静默数秒无任何反馈;最后一条是 user 即在等首字 */}
        {isPending && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
          <div className="flex gap-2.5 px-4 py-2" aria-hidden>
            <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-accent text-accent-foreground mt-0.5">
              <Bot className="w-3 h-3" />
            </div>
            <div className="flex items-center gap-1.5 py-1">
              <span className="w-2 h-2 bg-content-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-content-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-content-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
