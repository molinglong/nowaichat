'use client'

import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-xl bg-red-100 dark:bg-red-950/30 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-red-500 dark:text-red-400" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-content-primary">
            出现了一些问题
          </h1>
          <p className="text-content-secondary text-sm">
            应用遇到了意外错误，请尝试重新加载页面。
          </p>
          {process.env.NODE_ENV === 'development' && error.message && (
            <details className="mt-4 text-left">
              <summary className="cursor-pointer text-xs text-content-muted hover:text-content-primary">
                查看错误详情
              </summary>
              <pre className="mt-2 p-3 rounded-lg bg-surface-muted border border-line text-xs text-red-600 dark:text-red-400 overflow-x-auto whitespace-pre-wrap">
                {error.message}
                {error.digest && `\nDigest: ${error.digest}`}
              </pre>
            </details>
          )}
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-accent-foreground hover:bg-accent-hover text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-strong"
          >
            <RefreshCw className="w-4 h-4" />
            重试
          </button>
          <a
            href="/chat"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface-muted hover:bg-surface-subtle text-content-secondary text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-strong"
          >
            <Home className="w-4 h-4" />
            返回首页
          </a>
        </div>
      </div>
    </div>
  )
}
