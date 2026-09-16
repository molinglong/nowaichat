'use client'

import { Eye } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PreviewBlockProps {
  code: string
  className?: string
}

// ── macOS-style header bar ──────────────────────────────────────────
function MacHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-code-header border-b border-line">
      <div className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57] border border-[#e0443e]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e] border border-[#dea123]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840] border border-[#1eaa33]" />
      </div>
      <span className="text-[11px] text-content-muted font-mono select-none">{title}</span>
      <div className="w-3" />
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────
export function PreviewBlock({ className }: PreviewBlockProps) {
  return (
    <div className={cn('my-3 rounded-lg overflow-hidden border border-line', className)}>
      <MacHeader title="preview" />
      <div className="bg-code-bg p-4 text-xs text-content-muted">
        <div className="flex items-center gap-2 mb-2">
          <Eye className="w-4 h-4" />
          <span>请点击代码块右侧的&quot;预览&quot;按钮查看完整效果</span>
        </div>
        <p>该预览窗口支持：</p>
        <ul className="ml-4 mt-1 space-y-0.5 text-content-secondary">
          <li>✅ HTML/CSS/JavaScript 渲染</li>
          <li>✅ 外部资源加载（CDN）</li>
          <li>✅ 交互操作（按钮、表单等）</li>
          <li>⚠️ API 请求需要同源策略</li>
        </ul>
      </div>
    </div>
  )
}
