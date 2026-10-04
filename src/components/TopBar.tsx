'use client'

import { Menu, FileCode2, Keyboard, MessageSquarePlus, MessagesSquare, FolderTree, Settings as SettingsIcon } from 'lucide-react'
import { useRouter, usePathname } from 'next/navigation'
import { useChatStore } from '@/store/chat-store'
import { useEffect, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useIsTauri } from '@/lib/tauri'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { prefetchTabData as prefetchTabDataShared } from '@/lib/query/prefetchTab'
// 「对话资料」面板占位宽:让位量与 ChatPanel/OutlineSidebar 共用同一组常量(单一事实源)
import { INFO_PANEL_WIDTH, INFO_TAB_WIDTH } from './chat/InfoAsidePanel'
import { useIsComputerMode } from '@/hooks/useIsComputerMode'

// 快捷键提示表:与已实现行为一一对应(j/k 与 Enter 复制见 MessageList,搜索见 Sidebar)
const HOTKEY_HINTS: ReadonlyArray<{ keys: string; desc: string }> = [
  { keys: 'Enter', desc: '发送消息' },
  { keys: 'Shift + Enter', desc: '输入框换行' },
  { keys: 'J / K', desc: '选中下一条 / 上一条消息' },
  { keys: 'Enter', desc: '复制选中的消息' },
  { keys: 'Esc', desc: '取消选中' },
  { keys: '⌘ / Ctrl + K', desc: '搜索会话' },
]

/**
 * 顶栏(T-C 顶栏下沉)。
 *
 * 结构:
 * - <md 移动端:保留原顶栏带(汉堡开侧栏抽屉 + 页面标题 + 设置),顶部导航由 BottomDock 接管
 * - ≥md 桌面端:顶栏带整体下线 —— 页面导航进侧边栏(SidebarNav),工具簇浮到内容区右上,
 *   主区拿回整条高度;右缘随右侧编辑器/产物面板让位(定位改 right-*)
 *
 * 主区拿回高度后,本组件返回的两块(移动带 + 浮动簇)一个在流内、一个绝对定位,
 * 由 (app)/layout.tsx 的内容列(relative)承接。
 */
export function TopBar() {
  const inTauri = useIsTauri()
  // 从 store 读 currentConversationId:克隆分支时用 —— 用 selector 而非全量订阅(zustand v5 下避免过度渲染)
  const conversationTitle = useChatStore((s) => s.conversationTitle)
  const toggleSidebar = useChatStore((s) => s.toggleSidebar)
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const bumpConversationVersion = useChatStore((s) => s.bumpConversationVersion)
  const setSettingsOpen = useChatStore((s) => s.setSettingsOpen)
  // 写作画布面板打开时浮动工具簇同步让位(与 ChatPanel/WriteDocPanel 同宽同动画)
  const writePanelOpen = useChatStore((s) => s.writePanelDocId !== null)
  // 代码编辑器已是 Side Pane 的代码 tab([P1 改版]):不再各自占屏
  const codePanelOpen = useChatStore((s) => s.codePanelOpen)
  // 工作态(仅桌面端):右侧 Side Pane 常驻开关
  const workMode = useChatStore((s) => s.workMode)
  const setWorkMode = useChatStore((s) => s.setWorkMode)
  const previewOpen = useChatStore((s) => s.previewCode !== null)
  // 右侧「对话资料」面板:浮动工具簇要跟着让位,否则压在面板头上
  // (2026-09-29 实测:4 键态胶囊 x 1099..1301 完全盖住面板收起键 x 1279..1301,
  //  elementFromPoint 命中胶囊的「设置」键 —— 面板收起键点不到;收起态 28px 竖标签同样被吃 16px)。
  // 与 ChatPanel 的 infoSlotOccupied 同口径:面板登场时 = 有会话且无右侧抽屉接管
  // (写作画布/预览在上面的让位分支里已先行走掉,这里再排掉代码面板与文件编辑器);
  // 让位量 = 面板实际占位宽(展开 INFO_PANEL_WIDTH / 收起 INFO_TAB_WIDTH)+ 本簇自己的 12px 边距,
  // 与 OutlineSidebar 刻度列同一组常量、同一手法。
  const infoPanelOpen = useChatStore((s) => s.infoPanelOpen)
  const editorFileOpen = useChatStore((s) => s.editorFile !== null)
  // 电脑模式限定:平板/手机(触屏为主)不渲染资料面板,这里也不让位
  const isComputerMode = useIsComputerMode()
  const infoSlotOccupied =
    isComputerMode && !!currentConversationId && !codePanelOpen && !editorFileOpen
  const infoRightOffset = infoSlotOccupied
    ? (infoPanelOpen ? INFO_PANEL_WIDTH : INFO_TAB_WIDTH) + 12
    : 0
  // 次要工具入口隐藏口径:仅覆盖层(写作画布/聊天预览)打开时——tab 不再遮聊天
  const panelOpen = writePanelOpen || previewOpen
  const openCodePanel = useChatStore((s) => s.openCodePanel)
  const setSideTab = useChatStore((s) => s.setSideTab)
  const sidePaneWidth = useChatStore((s) => s.sidePaneWidth)
  const [title, setTitle] = useState(conversationTitle)
  // 快捷键说明弹层开合
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const queryClient = useQueryClient()

  // Update local state when store changes
  useEffect(() => {
    setTitle(conversationTitle)
  }, [conversationTitle])

  // 启动时预热一次聊天数据,这样首次进入 /chat 时 cache 已经在
  useEffect(() => {
    prefetchTabDataShared(queryClient, 'chat')
  }, [queryClient])

  // 在 /images 等页面显示固定的页面标题(移动端顶栏带用)
  const isImagesPage = pathname?.startsWith('/images')
  const isExplorePage = pathname?.startsWith('/explore')
  const isStudyPage = pathname?.startsWith('/study')
  const isWritePage = pathname?.startsWith('/write')
  const displayTitle = isImagesPage ? '生图工作台' : isExplorePage ? '观点探索' : isStudyPage ? '错题本' : isWritePage ? '写作画布' : (title || '新对话')

  /**
   * 「在新对话继续」:把当前对话(含所有上下文消息)用 LLM 压缩成结构化摘要,
   * 再以「1 条 system 摘要 + 可选 1 条 user 草稿」的形式创建新对话。
   * 避免在原对话里继续聊导致上下文被新问题污染;也避免新对话带着成百上千条原文。
   * 后端失败会兜底到复制原文,功能不丢。
   *
   * 后端: POST /api/conversations/branch
   */
  const [isBranching, setIsBranching] = useState(false)
  const handleBranchConversation = useCallback(async () => {
    if (isBranching || !currentConversationId) return
    setIsBranching(true)
    try {
      const res = await fetch('/api/conversations/branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: currentConversationId }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail?.error ?? `HTTP ${res.status}`)
      }
      const newConv = (await res.json()) as {
        id: string
        title?: string
        mode?: 'compressed' | 'cloned'
        summary?: string
        warning?: string
      }
      const modeLabel =
        newConv.mode === 'compressed'
          ? '已压缩上文,新对话已就绪'
          : newConv.mode === 'cloned'
            ? '压缩失败,已克隆原对话'
            : '新对话已就绪'
      const summaryPreview = newConv.summary ? newConv.summary.slice(0, 80) + '…' : ''
      toast.success(summaryPreview ? `${modeLabel}\n${summaryPreview}` : modeLabel, {
        title: '分支对话',
      })
      // 通知侧边栏刷新会话列表（创建了新对话）
      bumpConversationVersion()
      router.push(`/chat/c/${newConv.id}`)
    } catch (err) {
      console.error('[TopBar] Failed to branch conversation:', err)
      toast.error(err instanceof Error ? err.message : '创建分支对话失败,请重试', {
        title: '分支对话',
      })
    } finally {
      setIsBranching(false)
    }
  }, [isBranching, currentConversationId, router, bumpConversationVersion])

  // 仅在已有具体对话时(非空白新对话)显示「在新对话继续」按钮
  const canBranch = !!currentConversationId && pathname?.startsWith('/chat/c/')

  // 打开代码编辑器:已开(任意 tab)时跳到代码 tab,未开则打开代码 tab 并带出 Side Pane。
  // 无网络请求、无手动新建——代码文档由 write_code 工具产生,无产物时 tab 内显示引导。
  const handleOpenCodePanel = useCallback(() => {
    if (codePanelOpen) setSideTab('code')
    else openCodePanel()
  }, [codePanelOpen, openCodePanel, setSideTab])

  const dragProps = inTauri
    ? {
        'data-tauri-drag-region': '',
        style: { WebkitAppRegion: 'drag' } as React.CSSProperties,
      }
    : {}

  return (
    <>
      {/* ── ≥md 窗口拖动带(仅客户端):顶栏带下沉后内容区顶部没有抓手,
             仅侧栏头部可拖窗,窗口几乎"钉"在原位。这里补一条与浮簇同层的
             透明拖动带(内容区顶部 12px),把「抓顶部空白即可移动窗口」的
             直觉还回来;右侧浮簇 z-40 压其上,按钮不受影响。
             12px 高是安全值:各 tab 顶部栏内容起于 y=8~12px,不遮挡可点区域;
             聊天滚动区顶部另有 48px 留白带(md:pt-12),叠加后左中区域更好抓。
             空 div 无子元素:属性取默认(bare)语义 —— 命中即拖;
             双击由 Tauri 内置脚本转 maximize(再挂 onDoubleClick 会二次切换)。 */}
      {inTauri && (
        <div
          aria-hidden
          className="hidden md:block absolute inset-x-0 top-0 z-30 h-3"
          data-tauri-drag-region=""
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        />
      )}

      {/* ── <md 移动端顶栏带(原样保留):汉堡 + 页面标题 + 设置 ──
             data-app-topbar: 向上弹出的浮动菜单据此避让此带,
             不让菜单顶被这根 fixed 带盖住(见 useMaskMenuMaxHeight) ── */}
      <header
        data-app-topbar=""
        className="md:hidden relative z-40 flex items-center h-11 px-1.5 shrink-0 m-1.5 rounded-xl border border-line/50 bg-surface-glass glass-blur"
        {...dragProps}
        {...(inTauri
          ? {
              onDoubleClick: () => {
                import('@/lib/tauri').then(({ tauri }) => tauri.toggleMaximize())
              },
            }
          : {})}
      >
        <div className="flex items-center gap-0.5 min-w-0 flex-1">
          <button
            onClick={toggleSidebar}
            className="shrink-0 p-2 -ml-1 rounded-md text-content-secondary hover:text-content-primary hover:bg-surface-subtle transition-colors active:scale-95 touch-manipulation"
            aria-label="打开侧边栏"
            title="打开侧边栏"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <Menu className="w-4 h-4" />
          </button>
          {/* 聊天 / 工作 模式开关(仅桌面客户端):「工作」= 右侧产物区滑出并常驻。
              纯状态切换 —— 不跳路由、不重建会话(useChat 状态留在 ChatPanel 内),收起即纯聊天 */}
          {inTauri && (
            <div
              role="tablist"
              aria-label="聊天 / 工作"
              className="shrink-0 hidden sm:flex items-center gap-0.5 p-0.5 ml-1 rounded-lg bg-surface-subtle/70"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <button
                role="tab"
                aria-selected={!workMode}
                onClick={() => setWorkMode(false)}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all duration-150 touch-manipulation',
                  !workMode
                    ? 'bg-surface text-content-primary shadow-sm'
                    : 'text-content-secondary hover:text-content-primary active:scale-95'
                )}
                title="聊天模式（收起右侧产物区）"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <MessagesSquare className="w-3.5 h-3.5" />
              </button>
              <button
                role="tab"
                aria-selected={workMode}
                onClick={() => setWorkMode(true)}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all duration-150 touch-manipulation',
                  workMode
                    ? 'bg-surface text-content-primary shadow-sm'
                    : 'text-content-secondary hover:text-content-primary active:scale-95'
                )}
                title="工作模式（右侧滑出产物区：预览 / 全部文件）"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <FolderTree className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <span className="text-sm font-medium text-content-secondary truncate ml-1.5">
            {displayTitle}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* 设置入口:正常模式打开完整设置;临时模式打开精简版(仅通用/帮助/关于) */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="shrink-0 inline-flex items-center justify-center p-2 rounded-md text-content-secondary hover:text-content-primary hover:bg-surface-subtle transition-all duration-150 active:scale-95 touch-manipulation"
            aria-label="设置"
            title="设置"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <SettingsIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* ── ≥md 浮动工具簇(T-C):顶栏带下线后,工具浮在内容区右上 ──
          CAP 胶囊化(2026-09-29 拍板):给既有包围盒显形 —— 1px 描边 + 5px 内边距 = 原 6px,
          外框仍是 94×38、三键坐标零位移;边距 12/12,让位量上再叠加常量
          [P1]right 跟随 Side Pane 实际宽度(可拖拽);「对话资料」面板在场时按面板占位宽让位
          (292 / 40 —— 面板占多大就退多远,外加自己那份 12px);覆盖层打开时退回各自让位宽度 */}
      <div
        className={cn(
          'hidden md:flex absolute top-3 z-40 items-center gap-0.5 p-[5px] border border-line rounded-full bg-surface-glass glass-blur shadow-sm transition-[right] duration-300 ease-out right-3'
        )}
        style={
          {
            right: inTauri && workMode && !writePanelOpen && !previewOpen
              ? `${sidePaneWidth + 12}px`
              : writePanelOpen || previewOpen
                ? 'calc(min(46vw, 720px) + 12px)'
                : infoSlotOccupied
                  ? `${infoRightOffset}px`
                  : undefined,
          } as React.CSSProperties
        }
        {...dragProps}
      >
        {/* 聊天 / 工作 模式开关(仅桌面客户端)已下沉到侧边栏「聊天」导航之上;
            这里只剩移动端顶栏那一份(见上方 md:hidden 分支) */}
        {/* 「在新对话继续」按钮(仅在已有具体对话时显示) */}
        {canBranch && !panelOpen && (
          <button
            onClick={handleBranchConversation}
            disabled={isBranching}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-all duration-150 touch-manipulation shrink-0',
              'text-content-secondary hover:text-content-primary hover:bg-surface-subtle active:scale-95',
              isBranching && 'opacity-60 cursor-wait'
            )}
            aria-label="在新对话继续(保留上下文)"
            title="克隆当前对话到新窗口,保留全部上下文"
            style={{ WebkitTapHighlightColor: 'transparent', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <MessageSquarePlus className={cn('w-3.5 h-3.5', isBranching && 'animate-pulse')} />
            <span className="hidden sm:inline">在新对话继续</span>
          </button>
        )}
        {/* 代码编辑器入口([P1]):跳到 Side Pane 的代码 tab(已开则激活);写作画布覆盖层打开时隐藏 */}
        {!writePanelOpen && (
          <button
            onClick={handleOpenCodePanel}
            className="shrink-0 inline-flex items-center justify-center p-1.5 rounded-full text-content-secondary hover:text-content-primary hover:bg-surface-subtle transition-all duration-150 active:scale-95 touch-manipulation disabled:opacity-50"
            aria-label="代码编辑器"
            title="打开代码编辑器(写代码 / 让 AI 改代码)"
            style={{ WebkitTapHighlightColor: 'transparent', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <FileCode2 className="w-3.5 h-3.5" />
          </button>
        )}
        {/* 快捷键说明:轻量弹层,提升 j/k 等隐藏快捷键的可发现性 */}
        <div className={panelOpen ? 'hidden' : 'relative shrink-0'}>
          <button
            onClick={() => setHotkeysOpen((v) => !v)}
            className="shrink-0 inline-flex items-center justify-center p-1.5 rounded-full text-content-secondary hover:text-content-primary hover:bg-surface-subtle transition-all duration-150 active:scale-95 touch-manipulation"
            aria-label="键盘快捷键"
            title="键盘快捷键"
            aria-haspopup="dialog"
            aria-expanded={hotkeysOpen}
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <Keyboard className="w-3.5 h-3.5" />
          </button>
          {hotkeysOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setHotkeysOpen(false)} />
              <div
                className="absolute right-0 top-full mt-1.5 z-50 w-64 rounded-xl border border-line bg-surface shadow-lg p-3"
                role="dialog"
                aria-label="键盘快捷键"
              >
                <div className="text-xs font-medium text-content-primary mb-2">键盘快捷键</div>
                <ul className="space-y-1.5 text-[11px] text-content-secondary">
                  {HOTKEY_HINTS.map((h, i) => (
                    <li key={i} className="flex items-center justify-between gap-3">
                      <span className="min-w-0">{h.desc}</span>
                      <kbd className="shrink-0 px-1.5 py-0.5 rounded border border-line bg-surface-muted text-[10px] font-mono text-content-muted">
                        {h.keys}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
        {/* 设置入口(与侧栏用户行齿轮同一个弹窗;临时模式下为精简版) */}
        <button
          onClick={() => setSettingsOpen(true)}
          className="shrink-0 inline-flex items-center justify-center p-1.5 rounded-full text-content-secondary hover:text-content-primary hover:bg-surface-subtle transition-all duration-150 active:scale-95 touch-manipulation"
          aria-label="设置"
          title="设置"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <SettingsIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </>
  )
}
