'use client'

/**
 * 聊天内嵌写作画布面板 —— 豆包式右侧滑出,聊天与文档并排,不再跳转页面。
 * 桌面端固定右侧 min(46vw,720px) 宽(聊天主区同步压缩让位,见 ChatPanel),移动端全屏覆盖。
 * 内容复用 WriteEditor(自包含:加载/自动保存/流式生成/划词改写)。
 * 入口:write_document 文档卡片「打开」(WriteDocCard);打开状态在 chat-store(writePanelDocId)。
 * 关闭时延迟卸载编辑器:既保住滑出动画,也让 WriteEditor 卸载补存正常执行。
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, PenLine, X } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'
import { WriteEditor } from './WriteEditor'

/** 与 transition-duration 保持一致;关闭后延迟此时长再卸载编辑器 */
const CLOSE_ANIM_MS = 300

export function WriteDocPanel() {
  const router = useRouter()
  const writePanelDocId = useChatStore((s) => s.writePanelDocId)
  const closeWritePanel = useChatStore((s) => s.closeWritePanel)
  const open = writePanelDocId !== null

  // 关闭动画播完再真正卸载编辑器(卸载时会补存未保存改动)
  const [renderDocId, setRenderDocId] = useState<string | null>(null)
  useEffect(() => {
    if (writePanelDocId) {
      setRenderDocId(writePanelDocId)
      return
    }
    const t = setTimeout(() => setRenderDocId(null), CLOSE_ANIM_MS)
    return () => clearTimeout(t)
  }, [writePanelDocId])

  // ESC 关闭(与编辑器内的 ⌘/Ctrl+S 保存不冲突)
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeWritePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeWritePanel])

  // 逃生舱:跳 /write 完整工作区(带文档列表/深链定位),跳转前收起面板防回来时残留
  function openFullCanvas() {
    const id = renderDocId
    closeWritePanel()
    router.push(id ? `/write?doc=${id}` : '/write')
  }

  return (
    <aside
      aria-hidden={!open}
      className={`fixed inset-y-0 right-0 z-[80] w-full md:w-[min(46vw,720px)] flex flex-col
        bg-surface border-l border-line shadow-2xl
        transition-transform duration-300 ease-out
        ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}`}
    >
      {/* 面板头 */}
      <div className="shrink-0 flex items-center gap-2 h-12 px-3 border-b border-line">
        <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
          <PenLine className="w-3.5 h-3.5 text-accent" />
        </div>
        <span className="text-xs font-medium text-content-primary">写作画布</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={openFullCanvas}
          title="打开完整写作工作区"
          className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-content-secondary
            hover:text-content-primary hover:bg-surface-subtle transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">完整画布</span>
        </button>
        <button
          type="button"
          onClick={closeWritePanel}
          aria-label="关闭写作画布"
          className="p-1.5 rounded-md text-content-secondary hover:text-content-primary
            hover:bg-surface-subtle transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 编辑器:open 后挂载,关闭延迟卸载;移动端「列表」按钮 = 去完整画布 */}
      {renderDocId && (
        <div className="flex-1 min-h-0">
          <WriteEditor key={renderDocId} docId={renderDocId} onOpenList={openFullCanvas} />
        </div>
      )}
    </aside>
  )
}
