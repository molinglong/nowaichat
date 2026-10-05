'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ConfirmDialogProps {
  open: boolean
  /** 标题行,如「删除 3 个对话」 */
  title: string
  /** 正文说明,写清后果(不可恢复/连带删除什么) */
  description: string
  confirmLabel?: string
  cancelLabel?: string
  /** 危险操作:确认按钮走红底 */
  danger?: boolean
  /** 确认动作执行中:两个按钮都禁用,确认按钮显示「正在删除…」 */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 通用危险操作确认弹窗,替代原生 window.confirm。
 *
 * 必须 Portal 到 body:侧边栏 aside 带 glass-blur(backdrop-filter),
 * 在其内部 `fixed` 会以 aside 而不是视口为包含块,遮罩罩不住主内容区。
 * 面板按弹窗纯色背景规范用 bg-surface,不做玻璃拟态。
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  // 打开即把焦点交给取消按钮(默认回车不该执行不可恢复的操作),Esc 取消
  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus({ preventScroll: true })
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onCancel])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => { if (!busy) onCancel() }}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className={cn(
          'relative w-full max-w-sm rounded-xl border border-line bg-surface shadow-2xl',
          'px-4 pt-4 pb-3.5'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2.5">
          {danger && (
            <span className="mt-0.5 shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-red-500/10">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500 dark:text-red-400" aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-content-primary">{title}</h3>
            <p className="mt-1 text-xs leading-5 text-content-muted">{description}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-8 px-3 rounded-lg text-xs font-medium border border-line/40 bg-surface-muted/60
              text-content-secondary hover:bg-surface-subtle transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              'h-8 px-3 rounded-lg text-xs font-medium transition-colors disabled:opacity-60',
              danger
                ? 'bg-red-500 text-white hover:bg-red-600 dark:bg-red-500/90 dark:hover:bg-red-500'
                : 'bg-accent text-white hover:bg-accent-hover'
            )}
          >
            {busy ? '正在删除…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
