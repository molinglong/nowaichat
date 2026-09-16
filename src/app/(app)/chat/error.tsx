'use client'

import { AlertTriangle, RefreshCw, MessageSquare } from 'lucide-react'

export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex items-center justify-center h-full bg-surface px-4">
      <div className="max-w-sm w-full text-center space-y-5">
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-xl bg-red-100 dark:bg-red-950/30 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-red-500 dark:text-red-400" />
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-content-primary">
            聊天加载失败
          </h2>
          <p className="text-content-secondary text-sm">
            无法加载对话内容，请尝试重新加载或返回新建对话。
          </p>
          {process.env.NODE_ENV === 'development' && error.message && (
            <p className="mt-2 text-xs text-red-500 dark:text-red-400 font-mono">
              {error.message}
            </p>
          )}
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-accent-foreground hover:bg-accent-hover text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-strong"
          >
            <RefreshCw className="w-4 h-4" />
            重试
          </button>
          <a
            href="/chat"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-muted hover:bg-surface-subtle text-content-secondary text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-strong"
          >
            <MessageSquare className="w-4 h-4" />
            新对话
          </a>
        </div>
      </div>
    </div>
  )
}
