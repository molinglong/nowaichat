'use client'

/**
 * 聊天内嵌 HTML 预览面板 —— 写作画布式右侧滑出(CodeBlock 工具行「预览」/ 右键菜单触发)。
 * 桌面端固定右侧 min(46vw,720px) 宽(聊天主区同步压缩让位,见 ChatPanel),移动端全宽覆盖。
 * 打开状态在 chat-store(previewCode)。iframe 用 srcDoc 挂载:
 * - 弃 data: URI:Chrome 对 data: URL 有 ~2MB 上限,AI 生成的大页面会静默截断白屏
 * - sandbox 只放行 scripts/forms/popups,不给 allow-same-origin → opaque origin,脚本摸不到父页面
 * 关闭时延迟卸载 iframe:既保住滑出动画,也让最后一次渲染停到动画播完。
 */
import { useCallback, useEffect, useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'

/** 与 transition-duration 保持一致;关闭后延迟此时长再卸载 iframe */
const CLOSE_ANIM_MS = 300
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2
const ZOOM_STEP = 0.25

export function ChatPreviewPanel() {
  const previewCode = useChatStore((s) => s.previewCode)
  const setPreviewCode = useChatStore((s) => s.setPreviewCode)
  const open = previewCode !== null

  // 关闭动画播完再真正卸载 iframe
  const [renderCode, setRenderCode] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    if (previewCode !== null) {
      setRenderCode(previewCode)
      return
    }
    const t = setTimeout(() => setRenderCode(null), CLOSE_ANIM_MS)
    return () => clearTimeout(t)
  }, [previewCode])

  // 换代码时重置缩放(不同页面长宽差异大,残留缩放容易误认为渲染异常)
  useEffect(() => {
    setZoom(1)
  }, [renderCode])

  // 移动端全宽覆盖时锁背景滚动;ESC 关闭
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPreviewCode(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [open, setPreviewCode])

  const close = useCallback(() => setPreviewCode(null), [setPreviewCode])

  return (
    <aside
      aria-hidden={!open}
      className={`fixed inset-y-0 right-0 z-[80] w-full md:w-[min(46vw,720px)] flex flex-col
        bg-surface border-l border-line shadow-2xl
        transition-transform duration-300 ease-out
        ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}`}
    >
      {/* 面板头:Mac 三点 + 标题 + 缩放 + 关闭 */}
      <div className="shrink-0 flex items-center gap-1.5 h-12 px-3 bg-code-header border-b border-line">
        <div className="flex items-center gap-1.5 mr-1" aria-hidden>
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57] border border-[#e0443e]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e] border border-[#dea123]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28c840] border border-[#1eaa33]" />
        </div>
        <span className="text-[11px] text-content-muted font-mono select-none">HTML Preview</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
          disabled={zoom <= ZOOM_MIN}
          className="flex items-center justify-center w-7 h-7 rounded-full bg-surface border border-line-strong text-content-secondary hover:bg-surface-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
          aria-label="缩小"
        >
          <Minus className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          className="text-[11px] text-content-secondary font-mono min-w-[3rem] text-center hover:text-content-primary transition-colors"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
          disabled={zoom >= ZOOM_MAX}
          className="flex items-center justify-center w-7 h-7 rounded-full bg-surface border border-line-strong text-content-secondary hover:bg-surface-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
          aria-label="放大"
        >
          <Plus className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={close}
          aria-label="关闭预览"
          className="ml-1 p-1.5 rounded-md text-content-muted hover:text-red-500 hover:bg-surface-subtle transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 预览:open 后挂载,关闭延迟卸载;zoom 用 transform scale,origin 左上 */}
      {renderCode !== null && (
        <div className="flex-1 min-h-0 overflow-hidden bg-white">
          <div
            className="w-full h-full"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          >
            <iframe
              title="HTML 预览"
              srcDoc={renderCode}
              sandbox="allow-scripts allow-forms allow-popups"
              className="w-full h-full bg-white border-0"
            />
          </div>
        </div>
      )}
    </aside>
  )
}
