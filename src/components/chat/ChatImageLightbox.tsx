'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useBackToClose } from '@/hooks/useBackToClose'
import type { Attachment } from '@/lib/attachment-types'

/**
 * 聊天图片浏览器(全屏 Lightbox)。
 *
 * 背景:用户上传的图片缩略图原来是 <a target="_blank">——手机端(Tauri 安卓壳/手机浏览器)
 * 点开即离开应用,"返回"要么掉回上一页丢聊天状态、要么干脆没反应(见 useBackToClose 注释
 * 里的同类事故)。改为应用内全屏预览:点缩略图开、点纱面/✕/系统返回/Escape 关。
 *
 * 渲染走 createPortal 到 body:聊天列存在 backdrop-blur 祖先,fixed 遮罩会被降级成
 * 相对祖先定位(见 backdrop-blur-fixed 记忆),挂 body 根治。
 */

/** 滑动换图的最小位移(px),小于视为点按 */
const SWIPE_THRESHOLD = 48

export function ChatImageLightbox({
  images,
  index,
  onClose,
  onIndexChange,
}: {
  /** 仅图片类附件(调用方过滤好),至少 1 条 */
  images: Attachment[]
  /** 当前查看的下标 */
  index: number
  onClose: () => void
  onIndexChange: (next: number) => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // 系统返回/浏览器手势返回先关本层,不跳页(与设置弹窗同一套哨兵机制)
  useBackToClose(true, onClose)

  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // 桌面端键盘:Esc 关闭,左右键换图
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
      else if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      else if (e.key === 'ArrowRight' && index < images.length - 1) onIndexChange(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, images.length, onIndexChange])

  const touchStartX = useRef<number | null>(null)
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null
  }, [])
  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = touchStartX.current
      touchStartX.current = null
      if (start == null) return
      const dx = (e.changedTouches[0]?.clientX ?? start) - start
      if (Math.abs(dx) < SWIPE_THRESHOLD) return
      if (dx < 0 && index < images.length - 1) onIndexChange(index + 1)
      else if (dx > 0 && index > 0) onIndexChange(index - 1)
    },
    [index, images.length, onIndexChange]
  )

  if (!mounted || images.length === 0) return null
  const att = images[index]

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`图片预览:${att.name}`}
      className="fixed inset-0 z-[300] flex flex-col bg-black/90 select-none"
      style={{ overscrollBehavior: 'contain' }}
      onClick={onClose}
    >
      {/* 顶栏:文件名 + 关闭(不随图切换变化,独立成层避免被大图顶开) */}
      <div
        className="flex items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),12px)] pb-2"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="min-w-0 flex-1 truncate text-xs text-white/70">{att.name}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭图片预览"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* 大图区:点图不关(误触率高),点纱面才关;左右滑动换图 */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-2"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={att.url}
          src={att.url}
          alt={att.name}
          draggable={false}
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />

        {index > 0 && (
          <button
            type="button"
            aria-label="上一张"
            onClick={(e) => {
              e.stopPropagation()
              onIndexChange(index - 1)
            }}
            className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors sm:flex"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {index < images.length - 1 && (
          <button
            type="button"
            aria-label="下一张"
            onClick={(e) => {
              e.stopPropagation()
              onIndexChange(index + 1)
            }}
            className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors sm:flex"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* 底部计数:多图时显示 2 / 3 */}
      {images.length > 1 && (
        <div
          className="pb-[max(env(safe-area-inset-bottom),12px)] text-center text-xs text-white/60"
          onClick={(e) => e.stopPropagation()}
        >
          {index + 1} / {images.length}
        </div>
      )}
    </div>,
    document.body
  )
}
