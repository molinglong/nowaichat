import Link from 'next/link'
import { Home, MessageSquare } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="space-y-2">
          <p className="text-7xl sm:text-8xl font-bold text-surface-subtle select-none">
            404
          </p>
          <h1 className="text-2xl font-bold text-content-primary">
            页面不存在
          </h1>
          <p className="text-content-secondary text-sm">
            你访问的页面不存在或已被移除。
          </p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-accent-foreground hover:bg-accent-hover text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-strong"
          >
            <Home className="w-4 h-4" />
            返回首页
          </Link>
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface-muted hover:bg-surface-subtle text-content-secondary text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-strong"
          >
            <MessageSquare className="w-4 h-4" />
            新对话
          </Link>
        </div>
      </div>
    </div>
  )
}
