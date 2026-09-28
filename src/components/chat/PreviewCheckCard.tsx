'use client'

/**
 * 预览验证卡片 —— 渲染 preview_check 工具的结果。
 *
 * 三态（由 view.state 驱动）:
 * - 流式/待执行(input-streaming/input-available): 一行式「正在渲染预览验证…」+ spinner
 * - 通过(output-available + ok && errorCount===0): 绿色一行「预览验证通过,无脚本报错」
 * - 发现报错(ok && errorCount>0): 红色一行 + 报错明细(可展开,默认显示前 3 条)
 * - 失败(output-error 或 ok:false): 红色一行 + 原因
 *
 * AI 写完 HTML 后调 preview_check → 前端真实渲染并收集错误 → 结果回填模型自修。
 * 卡片只是把这次验证的结论可视化给用户看。
 */
import { memo, useState } from 'react'
import { CircleCheck, CircleAlert, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { isPreviewCheckOutput } from '@/lib/ai/preview-check-tool'
import type { ToolCallView } from './ToolCallCard'

interface PreviewCheckCardProps {
  view: ToolCallView
}

function PreviewCheckCardInner({ view }: PreviewCheckCardProps) {
  const [expanded, setExpanded] = useState(false)
  const parsed = isPreviewCheckOutput(view.output) ? view.output : null
  const pending = view.state === 'input-streaming' || view.state === 'input-available'
  const failed = view.state === 'output-error' || (parsed !== null && !parsed.ok)

  if (pending) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-line bg-surface-muted/50 text-xs text-content-secondary">
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-accent" />
        <span className="min-w-0 truncate">正在渲染预览、收集脚本报错…</span>
      </div>
    )
  }

  if (failed) {
    const msg =
      view.state === 'output-error'
        ? view.errorText || '预览验证失败'
        : parsed && !parsed.ok
          ? parsed.message
          : '预览验证失败'
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-500 dark:text-red-400">
        <CircleAlert className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0 truncate">预览验证未能完成:{msg}</span>
      </div>
    )
  }

  const errorCount = parsed && parsed.ok ? (parsed.errorCount ?? 0) : 0
  const errors = parsed && parsed.ok ? (parsed.errors ?? []) : []

  // 通过:绿色一行
  if (errorCount === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-xs text-emerald-600 dark:text-emerald-400">
        <CircleCheck className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0 truncate">预览验证通过,页面渲染无脚本报错</span>
      </div>
    )
  }

  // 发现报错:红色 + 明细展开
  return (
    <div className="px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 text-left text-red-500 dark:text-red-400"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0" />
        )}
        <CircleAlert className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          预览发现 {errorCount} 个报错,AI 修复中可展开查看
        </span>
      </button>
      {expanded && (
        <ul className="mt-1.5 space-y-1 pl-6 max-h-40 overflow-auto">
          {errors.map((e, i) => (
            <li key={i} className="font-mono text-[10px] leading-relaxed text-content-secondary break-all">
              {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export const PreviewCheckCard = memo(PreviewCheckCardInner)
