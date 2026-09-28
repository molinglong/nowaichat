'use client'

/**
 * WorkSidePane —— 工作态右侧「常驻 Side Pane」(P1 改版核心)。
 *
 * 取代旧的互斥覆盖面板:预览 / 文件树 / 编辑器 / 代码 成为同一面板里的 tab,
 * 单击切换、可关闭(编辑器/代码)、误关可重开(重新触发对应动作即可)。
 *
 * 行为口径(参照 ZCode):
 * - 收起不卸载:workMode 关闭 = display:none,组件保持挂载 —— 编辑缓冲/树展开/查询状态全保留;
 * - 拖拽调宽:分隔条拖动中只改 DOM 宽度(零重渲染),pointerup 才提交进 store 并持久化;
 * - 写作画布(WriteDocPanel)与聊天预览(ChatPreviewPanel)仍走独立覆盖层,打开时本 pane 让位。
 *
 * tab 激活状态在 chat-store.sideTab;编辑器/代码 tab 的开合由 editorFile/codePanelOpen 驱动。
 */
import { useRef } from 'react'
import type { UIMessage } from 'ai'
import { Eye, FileCode2, FolderTree, Pencil, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat-store'
import { useIsTauri } from '@/lib/tauri'
import { WorkspacePane } from './WorkspacePane'
import { FileEditorPanel } from '@/components/chat/FileEditorPanel'
import { CodePanel } from '@/components/code/CodePanel'

const MIN_W = 300
const MAX_W = 660

export function WorkSidePane({ messages }: { messages: UIMessage[] }) {
  const inTauri = useIsTauri()
  const workMode = useChatStore((s) => s.workMode)
  const sideTab = useChatStore((s) => s.sideTab)
  const setSideTab = useChatStore((s) => s.setSideTab)
  const sidePaneWidth = useChatStore((s) => s.sidePaneWidth)
  const setSidePaneWidth = useChatStore((s) => s.setSidePaneWidth)
  const editorFile = useChatStore((s) => s.editorFile)
  const closeEditor = useChatStore((s) => s.closeEditor)
  const codePanelOpen = useChatStore((s) => s.codePanelOpen)
  const closeCodePanel = useChatStore((s) => s.closeCodePanel)
  // 写作画布 / 聊天预览仍走覆盖层:它们打开时本 pane 让位(旧互斥语义仅剩这两处)
  const writeOverlay = useChatStore((s) => s.writePanelDocId !== null)
  const previewOverlay = useChatStore((s) => s.previewCode !== null)

  /* ---- 拖拽调宽:拖动中只写 DOM(零重渲染),pointerup 才提交 store 并持久化 ----
     注意:useRef 必须在所有早退 return 之前(Rules of Hooks),否则 inTauri 翻转时 hook 数量变化直接崩树 */
  const paneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startW: number; lastW?: number } | null>(null)

  if (!inTauri) return null

  const visible = workMode && !writeOverlay && !previewOverlay

  function onDragStart(e: React.PointerEvent) {
    dragRef.current = { startX: e.clientX, startW: sidePaneWidth, lastW: sidePaneWidth }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onDragMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d || !paneRef.current) return
    const w = Math.min(MAX_W, Math.max(MIN_W, d.startW + (d.startX - e.clientX)))
    paneRef.current.style.width = `${w}px`
    d.lastW = w
  }
  function onDragEnd() {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    if (typeof d.lastW === 'number') setSidePaneWidth(d.lastW)
  }

  const tabs: { key: 'preview' | 'files' | 'editor' | 'code'; label: string; icon: typeof Eye; closable?: boolean }[] = [
    { key: 'preview', label: '预览', icon: Eye },
    { key: 'files', label: '文件树', icon: FolderTree },
  ]
  if (editorFile) tabs.push({ key: 'editor', label: '编辑器', icon: Pencil, closable: true })
  if (codePanelOpen) tabs.push({ key: 'code', label: '代码', icon: FileCode2, closable: true })

  return (
    <div
      className="hidden md:flex h-full flex-none transition-none"
      style={{ display: visible ? undefined : 'none' }}
      aria-hidden={!visible}
    >
      {/* 拖拽分隔条 */}
      <div
        role="separator"
        aria-orientation="vertical"
        title="拖拽调整宽度"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        className="w-1.5 h-full cursor-col-resize group relative shrink-0"
      >
        <div
          className={cn(
            'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line-strong transition-all w-[3px] h-8 group-hover:bg-accent group-hover:h-14'
          )}
        />
      </div>

      {/* 面板本体 */}
      <div
        ref={paneRef}
        className="h-full flex flex-col min-w-0 bg-surface border-l border-line overflow-hidden"
        style={{ width: sidePaneWidth }}
      >
        {/* tab 栏 */}
        <div className="shrink-0 flex items-end gap-1 border-b border-line bg-surface-muted/60 px-2 pt-1.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSideTab(t.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-t-lg px-2.5 py-1.5 text-xs transition-colors border border-b-0',
                sideTab === t.key
                  ? 'bg-surface text-content-primary border-line font-medium'
                  : 'text-content-secondary border-transparent hover:text-content-primary hover:bg-surface-subtle'
              )}
            >
              <t.icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
              {t.closable && (
                <span
                  role="button"
                  aria-label={`关闭${t.label}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (t.key === 'editor') closeEditor()
                    else if (t.key === 'code') closeCodePanel()
                  }}
                  className="grid place-items-center w-3.5 h-3.5 rounded hover:bg-line-strong text-content-muted hover:text-content-primary"
                >
                  <X className="w-3 h-3" />
                </span>
              )}
            </button>
          ))}
          <div className="flex-1" />
          <span className="pb-1.5 pr-1 font-mono text-[10px] text-content-muted select-none">
            {sidePaneWidth}px
          </span>
        </div>

        {/* 内容区:三个 tab 面板保持挂载,display 切换(收起不卸载) */}
        <div className="flex-1 min-h-0 relative">
          <div
            className="absolute inset-0 flex flex-col"
            style={{ display: sideTab === 'preview' || sideTab === 'files' ? 'flex' : 'none' }}
          >
            <WorkspacePane embedded messages={messages} />
          </div>
          <div
            className="absolute inset-0 flex flex-col"
            style={{ display: sideTab === 'editor' ? 'flex' : 'none' }}
          >
            {editorFile ? <FileEditorPanel embedded /> : null}
          </div>
          <div
            className="absolute inset-0 flex flex-col"
            style={{ display: sideTab === 'code' ? 'flex' : 'none' }}
          >
            {codePanelOpen ? <CodePanel embedded /> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
