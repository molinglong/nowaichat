'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, ChevronDown, Copy, RefreshCw, Settings as SettingsIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat-store'
import { toast } from '@/lib/toast'
import type { ChatErrorInfo } from '@/lib/chat-errors'

interface ChatErrorBannerProps {
  info: ChatErrorInfo
  onRetry?: () => void
  onClose?: () => void
  /** compact: 对比泳道等窄容器用的缩小版 */
  size?: 'normal' | 'compact'
  className?: string
}

/**
 * 聊天错误横幅：中文主文案 + 行动指引 + 折叠的上游原文。
 * ChatPanel / CompareLane 共用，避免两处文案与交互漂移。
 */
export function ChatErrorBanner({
  info,
  onRetry,
  onClose,
  size = 'normal',
  className,
}: ChatErrorBannerProps) {
  const compact = size === 'compact'
  const isDev = process.env.NODE_ENV === 'development'
  // dev 默认展开便于排查；初始态与折叠按钮文案同源，避免标签与实际状态不一致
  const [rawOpen, setRawOpen] = useState(isDev)
  const setSettingsOpen = useChatStore((s) => s.setSettingsOpen)
  const setSettingsSection = useChatStore((s) => s.setSettingsSection)
  const router = useRouter()

  const handleAction = () => {
    if (!info.action) return
    if (info.action.settingsSection) {
      setSettingsSection(info.action.settingsSection)
      setSettingsOpen(true)
      return
    }
    if (info.action.href) router.push(info.action.href)
  }

  const handleCopy = async () => {
    const text = [info.title, info.detail, info.raw].filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('错误信息已复制，反馈时可直接粘贴')
    } catch {
      toast.error('复制失败，请手动选中原文复制')
    }
  }

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border border-red-200 bg-red-50',
        'dark:border-red-900/50 dark:bg-red-950/30',
        compact ? 'mx-2 mt-2 px-3 py-2' : 'mx-4 mt-3 mb-0 px-4 py-3 md:mt-12',
        className
      )}
    >
      <AlertCircle
        className={cn(
          'mt-0.5 shrink-0 text-red-500 dark:text-red-400',
          compact ? 'w-3.5 h-3.5' : 'w-5 h-5'
        )}
      />

      <div className="min-w-0 flex-1">
        {/* 主文案：发生了什么 + 该做什么 */}
        <p
          className={cn(
            'break-words font-medium text-red-600 dark:text-red-400',
            compact ? 'text-xs' : 'text-sm'
          )}
        >
          {info.detail}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {onRetry && (
            <button
              onClick={onRetry}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg bg-red-500 font-medium text-white',
                'transition-colors hover:bg-red-600',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-strong',
                compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
              )}
            >
              <RefreshCw className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
              重试
            </button>
          )}

          {info.action && (
            <button
              type="button"
              onClick={handleAction}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg bg-surface-muted font-medium text-content-secondary',
                'transition-colors hover:bg-surface-subtle',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-strong',
                compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
              )}
            >
              {info.action.settingsSection && <SettingsIcon className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />}
              {info.action.label}
            </button>
          )}

          {info.raw && (
            <button
              type="button"
              onClick={() => setRawOpen((v) => !v)}
              aria-expanded={rawOpen}
              className={cn(
                'inline-flex items-center gap-1 text-red-500/80 transition-colors hover:text-red-600 dark:text-red-400/70 dark:hover:text-red-300',
                compact ? 'text-[11px]' : 'text-xs'
              )}
            >
              <ChevronDown className={cn('w-3 h-3 transition-transform', rawOpen && 'rotate-180')} />
              {rawOpen ? '收起原始错误' : '查看原始错误'}
            </button>
          )}
        </div>

        {/* 服务商原文：默认折叠，仅用于排查与反馈 */}
        {info.raw && rawOpen && (
          <div className="mt-2 rounded-lg bg-surface/70 px-2.5 py-2">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-content-muted">
                {info.raw}
              </p>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-content-muted transition-colors hover:bg-surface-subtle hover:text-content-secondary"
                aria-label="复制错误信息"
              >
                <Copy className="w-3 h-3" />
                复制
              </button>
            </div>
          </div>
        )}
      </div>

      {onClose && (
        <button
          onClick={onClose}
          className="shrink-0 rounded-md p-1 text-red-400 transition-colors hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-300"
          aria-label="关闭错误提示"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}
