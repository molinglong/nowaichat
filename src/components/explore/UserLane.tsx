'use client'

import { useState, useRef } from 'react'
import { Send, Loader2, Sparkles, ShieldCheck, Eraser, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  polished?: string
}

interface UserLaneProps {
  messages: Message[]
  onSend: (content: string) => void
  onPolish: (content: string) => Promise<string>
  onFactCheck: (content: string, id: string) => void
  disabled: boolean
  isPolishing: boolean
  /** 当前输入框内容发生变化时调用, 用于触发"对草稿润色" */
  onDraftPolish?: (content: string) => Promise<string>
  /** 对当前输入框内容做事实核查 */
  onDraftFactCheck?: (content: string) => void
  /** 草稿润色中 */
  isDraftPolishing?: boolean
  /** 草稿润色结果 */
  draftPolished?: string | null
  /** 关闭草稿润色预览 */
  onDiscardDraftPolished?: () => void
}

export function UserLane({
  messages,
  onSend,
  onPolish,
  onFactCheck,
  disabled,
  isPolishing,
  onDraftPolish,
  onDraftFactCheck,
  isDraftPolishing = false,
  draftPolished = null,
  onDiscardDraftPolished,
}: UserLaneProps) {
  const [input, setInput] = useState('')
  const [polishingId, setPolishingId] = useState<string | null>(null)
  const [localPolished, setLocalPolished] = useState<Record<string, string>>({})
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = () => {
    if (!input.trim() || disabled) return
    onSend(input.trim())
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handlePolish = async (msg: Message) => {
    setPolishingId(msg.id)
    try {
      const polished = await onPolish(msg.content)
      setLocalPolished(prev => ({ ...prev, [msg.id]: polished }))
    } finally {
      setPolishingId(null)
    }
  }

  const handleApplyPolished = (msg: Message) => {
    const polished = localPolished[msg.id]
    if (!polished) return
    setInput(polished)
    setLocalPolished(prev => {
      const next = { ...prev }
      delete next[msg.id]
      return next
    })
  }

  // 输入框内草稿润色
  const handleDraftPolish = async () => {
    if (!input.trim() || !onDraftPolish) return
    const polished = await onDraftPolish(input.trim())
    if (polished && polished !== input.trim()) {
      setInput(polished)
    }
  }

  const handleDraftFactCheck = () => {
    if (!input.trim() || !onDraftFactCheck) return
    onDraftFactCheck(input.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 历史消息 - 最新在上 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="flex flex-col-reverse space-y-3 space-y-reverse">
          {messages.map((msg) => (
            <UserMessageCard
              key={msg.id}
              message={msg}
              onPolish={() => handlePolish(msg)}
              onFactCheck={() => onFactCheck(msg.content, msg.id)}
              onApplyPolished={() => handleApplyPolished(msg)}
              isPolishing={polishingId === msg.id}
              polished={localPolished[msg.id]}
            />
          ))}

          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-content-muted">
              <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-3">
                <Sparkles className="w-6 h-6 text-accent" />
              </div>
              <p className="text-sm">输入你的观点，与对手展开辩论</p>
              <p className="text-xs mt-1">助手会帮你搜索论据、审查逻辑</p>
            </div>
          )}
        </div>
      </div>

      {/* 输入框 */}
      <div className="shrink-0 p-4 border-t border-line/60 bg-surface">
        {/* 草稿润色预览 */}
        {draftPolished && (
          <div className="mb-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <div className="flex items-center gap-2 mb-1">
              <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">润色建议</span>
              <button
                onClick={onDiscardDraftPolished}
                className="ml-auto text-[10px] text-content-muted hover:text-content-secondary"
              >
                关闭
              </button>
            </div>
            <div className="text-xs text-content-secondary whitespace-pre-wrap">{draftPolished}</div>
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'
              }}
              onKeyDown={handleKeyDown}
              placeholder={disabled ? '等待对手发言...' : '输入你的观点...'}
              disabled={disabled}
              rows={1}
              className={cn(
                'w-full px-3 py-2.5 pr-10 rounded-xl resize-none',
                'bg-surface-muted border border-line/60 text-sm leading-relaxed',
                'placeholder:text-content-muted',
                'focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'max-h-[200px] overflow-y-auto'
              )}
            />
            {input.trim() && (
              <button
                onClick={() => setInput('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-surface-subtle text-content-muted hover:text-content-primary transition-colors"
              >
                <Eraser className="w-4 h-4" />
              </button>
            )}
          </div>
          {/* 草稿润色 */}
          {onDraftPolish && input.trim() && (
            <button
              onClick={handleDraftPolish}
              disabled={disabled || isDraftPolishing}
              className={cn(
                'shrink-0 p-2.5 rounded-xl transition-colors',
                'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                'hover:bg-emerald-500/20',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
              title="润色草稿"
            >
              {isDraftPolishing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Sparkles className="w-5 h-5" />
              )}
            </button>
          )}
          {/* 草稿事实核查 */}
          {onDraftFactCheck && input.trim() && (
            <button
              onClick={handleDraftFactCheck}
              disabled={disabled}
              className={cn(
                'shrink-0 p-2.5 rounded-xl transition-colors',
                'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                'hover:bg-amber-500/20',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
              title="事实核查"
            >
              <ShieldCheck className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={!input.trim() || disabled}
            className={cn(
              'shrink-0 p-2.5 rounded-xl transition-colors',
              'bg-accent text-accent-foreground',
              'hover:bg-accent-hover',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {disabled ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-content-muted">
          <span>Enter 发送 · Shift+Enter 换行</span>
          <span className="text-content-muted/60">先润色 / 核查，再发送，避免错把论据当观点</span>
        </div>
      </div>
    </div>
  )
}

function UserMessageCard({
  message,
  onPolish,
  onFactCheck,
  onApplyPolished,
  isPolishing,
  polished,
}: {
  message: Message
  onPolish: () => void
  onFactCheck: () => void
  onApplyPolished: () => void
  isPolishing: boolean
  polished?: string
}) {
  const [showActions, setShowActions] = useState(false)

  return (
    <div
      className="relative p-3 rounded-xl bg-accent/5 border border-accent/20"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-accent/10 flex items-center justify-center">
            <Sparkles className="w-3 h-3 text-accent" />
          </div>
          <span className="text-xs font-medium text-accent">你</span>
        </div>
        <span className="text-[10px] text-content-muted">
          {message.timestamp.toLocaleTimeString()}
        </span>
      </div>

      {/* 内容 */}
      <div className="text-sm leading-relaxed whitespace-pre-wrap">
        {message.content}
      </div>

      {/* 润色预览 */}
      {polished && (
        <div className="mt-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-center gap-2 mb-1">
            <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">润色建议</span>
          </div>
          <div className="text-xs text-content-secondary whitespace-pre-wrap">{polished}</div>
          <button
            onClick={onApplyPolished}
            className="mt-2 px-2 py-1 rounded text-[11px] bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/30 transition-colors"
          >
            使用润色版本
          </button>
        </div>
      )}

      {/* 操作按钮 */}
      <div
        className={cn(
          'flex items-center gap-2 mt-2 pt-2 border-t border-line/40 transition-opacity',
          showActions ? 'opacity-100' : 'opacity-0'
        )}
      >
        <button
          onClick={onPolish}
          disabled={isPolishing}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-content-secondary hover:text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
        >
          {isPolishing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Sparkles className="w-3 h-3" />
          )}
          润色
        </button>
        <button
          onClick={onFactCheck}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-content-secondary hover:text-amber-600 hover:bg-amber-500/10 transition-colors"
        >
          <ShieldCheck className="w-3 h-3" />
          核查
        </button>
      </div>
    </div>
  )
}
