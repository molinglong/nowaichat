'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'
import type { ModelDefinition } from '@/lib/ai/types'
import { PROVIDER_DOT } from '@/lib/ai/provider-meta'
import { cn } from '@/lib/utils'

/**
 * 方案 C 模型快切 —— iOS 半屏底部弹窗(≤md)。
 *
 * 设计稿定稿形态:顶部抓取条 + 「切换模型」标题;模型行 16px、细线分隔、
 * 选中行琥珀字 + 对勾;底部取消行(细线上边框,琥珀加粗字)。0.34s 弹性上滑。
 * 入口:欢迎页 hero 模型胶囊、输入框 compact 触发钮(ModelSelector 移动分支)。
 * 选中走 onModelChange + recordModelUsage,与桌面下拉同链路。
 */

interface ModelQuickSheetProps {
  open: boolean
  onClose: () => void
  models: ModelDefinition[]
  selectedModel: string
  onModelChange: (modelId: string) => void
}

export function ModelQuickSheet({ open, onClose, models, selectedModel, onModelChange }: ModelQuickSheetProps) {
  const recordModelUsage = useChatStore((s) => s.recordModelUsage)
  const [mounted, setMounted] = useState(false)
  // rendered=DOM 存在;shown=过渡目标态。开:双 RAF 置 shown 触发上滑;关:先落 shown,340ms 后卸载
  const [rendered, setRendered] = useState(false)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (open) {
      setRendered(true)
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShown(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        if (raf2) cancelAnimationFrame(raf2)
      }
    }
    setShown(false)
    if (!rendered) return
    const timer = window.setTimeout(() => setRendered(false), 340)
    return () => window.clearTimeout(timer)
  }, [open, rendered])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted || !rendered) return null

  const pick = (id: string) => {
    onModelChange(id)
    recordModelUsage(id)
    onClose()
  }

  return createPortal(
    <>
      {/* 背景压暗 */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-[57] bg-black/40 transition-opacity duration-300',
          shown ? 'opacity-100' : 'opacity-0'
        )}
      />
      {/* 半屏面板:左右贴边、顶部 40px 圆角、近实底玻璃 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="切换模型"
        className={cn(
          'fixed inset-x-0 bottom-0 z-[58] overflow-hidden rounded-t-[28px] border-t border-white/55',
          'bg-surface/95 shadow-[0_18px_50px_rgba(0,0,0,0.28)]',
          'transition-transform duration-[340ms] ease-[cubic-bezier(.32,.72,.28,1)]',
          shown ? 'translate-y-0' : 'translate-y-full'
        )}
        style={{
          WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
          backdropFilter: 'blur(28px) saturate(1.6)',
          paddingBottom: 'max(var(--sab, 0px), 6px)',
        }}
      >
        <div aria-hidden className="mx-auto mt-3 h-2 w-[46px] rounded-full bg-line-strong/40" />
        <p className="px-5 pb-2.5 pt-3.5 text-center text-sm font-semibold text-content-primary">切换模型</p>
        <div className="max-h-[52vh] overflow-y-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {models.length === 0 ? (
            <p className="px-6 py-6 text-center text-[13px] text-content-muted">请先在设置中配置 API Key</p>
          ) : (
            models.map((m, i) => {
              const on = m.id === selectedModel
              return (
                <button
                  key={m.id}
                  onClick={() => pick(m.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2.5 px-6 py-[15px] text-left text-base min-h-[44px] touch-manipulation',
                    i > 0 && 'border-t border-line/55',
                    on ? 'font-semibold text-accent' : 'text-content-primary active:bg-surface-subtle/60'
                  )}
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn('h-1.5 w-1.5 flex-none rounded-full', PROVIDER_DOT[m.provider] ?? 'bg-content-muted')} />
                    <span className="truncate">{m.name}</span>
                  </span>
                  <Check className={cn('h-[17px] w-[17px] flex-none text-accent', on ? 'opacity-100' : 'opacity-0')} />
                </button>
              )
            })
          )}
        </div>
        <button
          onClick={onClose}
          className="mt-1 w-full border-t border-line/70 py-4 text-center text-[17px] font-semibold text-accent active:bg-surface-subtle/50 touch-manipulation"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          取消
        </button>
      </div>
    </>,
    document.body
  )
}
