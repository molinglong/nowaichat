'use client'

import { Loader2, ShieldCheck, AlertTriangle } from 'lucide-react'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface OpponentMessage {
  id: string
  content: string
  timestamp: Date
}

interface OpponentLaneProps {
  messages: OpponentMessage[]
  isLoading: boolean
  onFactCheck: (content: string, id: string) => void
}

export function OpponentLane({ messages, isLoading, onFactCheck }: OpponentLaneProps) {
  return (
    <div className="shrink-0 max-h-[35vh] overflow-y-auto bg-surface-muted/30">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-3 text-xs text-content-muted">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <span>对手 AI</span>
          {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
        </div>

        {/* 最新消息在上: 使用 flex-col-reverse + 自定义插入顺序的 loading 提示 */}
        <div className="flex flex-col-reverse space-y-3 space-y-reverse">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-content-muted order-last">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>对手正在思考...</span>
            </div>
          )}
          {messages.map((msg) => (
            <OpponentMessageCard
              key={msg.id}
              message={msg}
              onFactCheck={onFactCheck}
            />
          ))}
          {messages.length === 0 && !isLoading && (
            <div className="text-sm text-content-muted text-center py-4">
              等待对手发言...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function OpponentMessageCard({
  message,
  onFactCheck,
}: {
  message: OpponentMessage
  onFactCheck: (content: string, id: string) => void
}) {
  const [showActions, setShowActions] = useState(false)

  return (
    <div
      className="relative p-3 rounded-xl bg-surface border border-line/60"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-red-500/10 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-red-500" />
          </div>
          <span className="text-xs font-medium text-red-600 dark:text-red-400">对手</span>
        </div>
        <span className="text-[10px] text-content-muted">
          {message.timestamp.toLocaleTimeString()}
        </span>
      </div>

      {/* 内容 */}
      <div className="text-sm leading-relaxed whitespace-pre-wrap">
        {message.content}
      </div>

      {/* 操作按钮 */}
      <div
        className={cn(
          'flex items-center gap-2 mt-2 pt-2 border-t border-line/40 transition-opacity',
          showActions ? 'opacity-100' : 'opacity-0'
        )}
      >
        <button
          onClick={() => onFactCheck(message.content, message.id)}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-content-secondary hover:text-amber-600 hover:bg-amber-500/10 transition-colors"
        >
          <ShieldCheck className="w-3 h-3" />
          事实核查
        </button>
      </div>
    </div>
  )
}
