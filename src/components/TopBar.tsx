'use client'

import { Menu, Plus, Sparkles, Scale, Check, ChevronDown, MessageSquarePlus, BookOpen, PenLine, Settings as SettingsIcon, Keyboard } from 'lucide-react'
import { useRouter, usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useChatStore } from '@/store/chat-store'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useIsTauri } from '@/lib/tauri'
import { useStartNewChat } from '@/hooks/useStartNewChat'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { prefetchTabData as prefetchTabDataShared, type TabKey } from '@/lib/query/prefetchTab'

// 快捷键提示表:与已实现行为一一对应(j/k 与 Enter 复制见 MessageList,搜索见 Sidebar)
const HOTKEY_HINTS: ReadonlyArray<{ keys: string; desc: string }> = [
  { keys: 'Enter', desc: '发送消息' },
  { keys: 'Shift + Enter', desc: '输入框换行' },
  { keys: 'J / K', desc: '选中下一条 / 上一条消息' },
  { keys: 'Enter', desc: '复制选中的消息' },
  { keys: 'Esc', desc: '取消选中' },
  { keys: '⌘ / Ctrl + K', desc: '搜索会话' },
]

export function TopBar() {
  const inTauri = useIsTauri()
  // 临时聊天模式(访客密码登录):隐藏设置入口(账户管理写操作已被服务端拦截)
  const { data: session } = useSession()
  const isEphemeral = session?.ephemeral === true
  // 从 store 读 currentConversationId:克隆分支时用 —— 用 selector 而非全量订阅(zustand v5 下避免过度渲染)
  const conversationTitle = useChatStore((s) => s.conversationTitle)
  const toggleSidebar = useChatStore((s) => s.toggleSidebar)
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const bumpConversationVersion = useChatStore((s) => s.bumpConversationVersion)
  const setSettingsOpen = useChatStore((s) => s.setSettingsOpen)
  // 写作画布面板打开时顶栏同步让位(与 ChatPanel/WriteDocPanel 同宽同动画)
  const writePanelOpen = useChatStore((s) => s.writePanelDocId !== null)
  const [title, setTitle] = useState(conversationTitle)
  // 中部胶囊「更多」二级菜单(收纳观点探索/错题本,保持胶囊组精简)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  // 快捷键说明弹层开合
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const queryClient = useQueryClient()

  // 导航过渡状态 —— 点击立刻设上, 导航完成(pathname 更新)清掉.
  const [pendingTab, setPendingTab] = useState<TabKey | null>(null)

  // Update local state when store changes
  useEffect(() => {
    setTitle(conversationTitle)
  }, [conversationTitle])

  // 路由变化时自动关闭更多菜单 + 清掉 pendingTab
  useEffect(() => {
    setMoreOpen(false)
    setPendingTab(null)
  }, [pathname])

  // 预编译路由 — 让 Next.js 在背景里把目标路由的 RSC chunk / page chunk 下好
  useEffect(() => {
    router.prefetch('/chat')
    router.prefetch('/images')
    router.prefetch('/explore')
    router.prefetch('/write')
  }, [router])

  // ── Tab 数据预热 ────────────────────────────────────────
  // 实现体抽到 lib/query/prefetchTab.ts(移动端 BottomDock 共用同一套预热),
  // 这里保留同名薄包装 —— 所有调用点零改动。
  const prefetchTabData = useCallback(
    (tab: TabKey) => prefetchTabDataShared(queryClient, tab),
    [queryClient]
  )

  // 启动时也预热一次,这样首次访问任意页面时 cache 已经在
  useEffect(() => {
    prefetchTabData('chat')
  }, [prefetchTabData])

  // 点击外部关闭「更多」二级菜单
  useEffect(() => {
    if (!moreOpen) return
    function onPointerDown(e: PointerEvent) {
      if (moreOpen && moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [moreOpen])

  // 在 /images 页面显示固定的页面标题
  const isImagesPage = pathname?.startsWith('/images')
  const isExplorePage = pathname?.startsWith('/explore')
  const isStudyPage = pathname?.startsWith('/study')
  const isWritePage = pathname?.startsWith('/write')
  const displayTitle = isImagesPage ? '生图工作台' : isExplorePage ? '观点探索' : isStudyPage ? '错题本' : isWritePage ? '写作画布' : (title || '新对话')

  // 活跃态
  const isChatActive = (!isImagesPage && !isExplorePage && !isStudyPage && !isWritePage) || pendingTab === 'chat'
  const isStudyActive = Boolean(isStudyPage)
  const isImagesActive = Boolean(isImagesPage) || pendingTab === 'images'
  const isExploreActive = Boolean(isExplorePage) || pendingTab === 'explore'
  const isWriteActive = Boolean(isWritePage) || pendingTab === 'write'
  // 「更多」按钮的激活态:探索/错题本/写作任一页面即点亮(收纳入口的父级高亮)
  const isMoreActive = isExploreActive || isStudyActive || isWriteActive

  const navigateTo = useCallback((tab: TabKey, go: () => void) => {
    setPendingTab(tab)
    go()
  }, [])

  // 「聊天」tab / 新对话入口:走统一的重置流程。
  // 旧的 router.replace('/chat') + router.refresh() 对 client page 无效:
  // replace 同路径是 no-op,refresh 重拉 RSC 但客户端状态全保留,
  // 表现为点击后毫无反应。见 useStartNewChat 的注释。
  const startNewChat = useStartNewChat()
  const handleNewChat = useCallback(() => {
    // 跨 tab 进入时给高亮过渡反馈;已在 /chat 时 nonce 重置本身立即生效
    if (pathname !== '/chat') setPendingTab('chat')
    startNewChat()
  }, [pathname, startNewChat])

  const handleGoImages = useCallback(() => {
    if (pathname?.startsWith('/images')) return
    // 在调用 router.push 之前预热 — 点按瞬间就开始拉数据
    prefetchTabData('images')
    navigateTo('images', () => router.push('/images'))
  }, [navigateTo, pathname, router, prefetchTabData])

  const handleGoExplore = useCallback(() => {
    if (pathname?.startsWith('/explore')) return
    prefetchTabData('explore')
    navigateTo('explore', () => router.push('/explore'))
  }, [navigateTo, pathname, router, prefetchTabData])

  const handleGoWrite = useCallback(() => {
    if (pathname?.startsWith('/write')) return
    navigateTo('write', () => router.push('/write'))
  }, [navigateTo, pathname, router])

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

  return (
    <header
      className={`relative z-40 flex items-center h-11 md:h-9 px-1.5 md:px-2 shrink-0 m-1.5 rounded-xl border border-line/50 bg-surface-glass backdrop-blur-xl transition-[margin] duration-300 ease-out ${writePanelOpen ? 'md:mr-[min(46vw,720px)]' : ''}`}
      {...(inTauri
        ? {
            'data-tauri-drag-region': '',
            style: { WebkitAppRegion: 'drag' } as React.CSSProperties,
            onDoubleClick: () => {
              import('@/lib/tauri').then(({ tauri }) => tauri.toggleMaximize())
            },
          }
        : {})}
    >
      {/* Left: 汉堡菜单(仅移动端可见) + 当前页标题 */}
      <div className="flex items-center gap-0.5 min-w-0 flex-1 max-w-[60%] md:max-w-[40%]">
        <button
          onClick={toggleSidebar}
          className="md:hidden shrink-0 p-2 -ml-1 md:p-1.5 rounded-md text-content-secondary hover:text-content-primary hover:bg-surface-subtle transition-colors active:scale-95 touch-manipulation"
          aria-label="打开侧边栏"
          title="打开侧边栏"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <Menu className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-content-secondary truncate ml-1.5 md:ml-1 md:text-xs md:text-content-muted">
          {displayTitle}
        </span>
      </div>

      {/* Center: 胶囊选项卡 — 绝对居中 */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center pointer-events-none">
        {/* ≥381px: 完整胶囊 */}
        <div className="hidden md:flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-subtle/70 pointer-events-auto">
          <button
            onClick={handleNewChat}
            onMouseEnter={() => prefetchTabData('chat')}
            onFocus={() => prefetchTabData('chat')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all duration-150 touch-manipulation',
              isChatActive
                ? 'bg-surface text-content-primary shadow-sm'
                : 'text-content-secondary hover:text-content-primary active:scale-95'
            )}
            aria-label="新对话"
            title="新对话"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">聊天</span>
          </button>
          {/* 临时聊天模式：只保留聊天，隐藏生图/探索/错题本入口 */}
          {!isEphemeral && (
          <>
          <button
            onClick={handleGoImages}
            onMouseEnter={() => prefetchTabData('images')}
            onFocus={() => prefetchTabData('images')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all duration-150 touch-manipulation',
              isImagesActive
                ? 'bg-surface text-content-primary shadow-sm'
                : 'text-content-secondary hover:text-content-primary active:scale-95'
            )}
            aria-label="生图工作台"
            title="生图工作台"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">生图</span>
          </button>
          {/* 更多:二级菜单收纳低频入口(探索/错题本),胶囊组只留高频的聊天/生图 */}
          <div ref={moreRef} className="relative">
            <button
              onClick={() => setMoreOpen((o) => !o)}
              onMouseEnter={() => prefetchTabData('explore')}
              onFocus={() => prefetchTabData('explore')}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all duration-150 touch-manipulation',
                isMoreActive || moreOpen
                  ? 'bg-surface text-content-primary shadow-sm'
                  : 'text-content-secondary hover:text-content-primary active:scale-95'
              )}
              aria-label="更多功能"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              title="更多功能"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <ChevronDown className={cn('w-3.5 h-3.5 transition-transform duration-150', moreOpen && 'rotate-180')} />
              <span className="hidden sm:inline">更多</span>
            </button>
            {moreOpen && (
              <div
                role="menu"
                className="absolute top-full right-0 mt-1.5 w-44 bg-surface border border-line/60 rounded-lg shadow-xl z-50 py-1 overflow-hidden"
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false)
                    handleGoExplore()
                  }}
                  onMouseEnter={() => prefetchTabData('explore')}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                    isExploreActive
                      ? 'bg-surface-subtle text-content-primary'
                      : 'text-content-secondary hover:bg-surface-subtle hover:text-content-primary'
                  )}
                >
                  <Scale className="w-3.5 h-3.5 shrink-0" />
                  <span className="flex-1">观点探索</span>
                  {isExploreActive && <Check className="w-3 h-3 shrink-0 text-accent" />}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false)
                    handleGoWrite()
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                    isWriteActive
                      ? 'bg-surface-subtle text-content-primary'
                      : 'text-content-secondary hover:bg-surface-subtle hover:text-content-primary'
                  )}
                >
                  <PenLine className="w-3.5 h-3.5 shrink-0" />
                  <span className="flex-1">写作画布</span>
                  {isWriteActive && <Check className="w-3 h-3 shrink-0 text-accent" />}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false)
                    if (!isStudyActive) router.push('/study')
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                    isStudyActive
                      ? 'bg-surface-subtle text-content-primary'
                      : 'text-content-secondary hover:bg-surface-subtle hover:text-content-primary'
                  )}
                >
                  <BookOpen className="w-3.5 h-3.5 shrink-0" />
                  <span className="flex-1">错题本</span>
                  {isStudyActive && <Check className="w-3 h-3 shrink-0 text-accent" />}
                </button>
              </div>
            )}
          </div>
          </>
          )}
        </div>

        {/* 极窄屏折叠菜单已移除:移动端页面导航由 BottomDock(底部毛玻璃 Dock)接管 */}
      </div>

      {/* Right: 「在新对话继续」按钮(仅在已有具体对话时显示) + 设置(固定最右侧)。
          不设 max-w 上限:flex-1 吸收左侧剩余空间,justify-end 把内容钉在右边缘,
          中间胶囊是绝对定位不受影响 */}
      <div className="flex items-center gap-0.5 min-w-0 flex-1 justify-end">
        {/* 写作画布面板打开时顶栏压缩,次要入口隐藏(canBranch 已含面板态判断) */}
        {canBranch && !writePanelOpen && (
          <button
            onClick={handleBranchConversation}
            disabled={isBranching}
            className={cn(
              'hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all duration-150 touch-manipulation shrink-0',
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
        {/* 快捷键说明:轻量弹层,提升 j/k 等隐藏快捷键的可发现性(紧邻设置入口) */}
        <div className={writePanelOpen ? 'hidden' : 'relative shrink-0 hidden md:block'}>
          <button
            onClick={() => setHotkeysOpen((v) => !v)}
            className="shrink-0 inline-flex items-center justify-center p-1.5 rounded-md text-content-secondary hover:text-content-primary hover:bg-surface-subtle transition-all duration-150 active:scale-95 touch-manipulation"
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
        {/* 设置入口:正常模式打开完整设置;临时模式打开精简版(仅通用/帮助/关于,
            账户管理类板块及其数据加载已在 SettingsModal 内按 isEphemeral 跳过) */}
        <button
          onClick={() => setSettingsOpen(true)}
            className="shrink-0 inline-flex items-center justify-center p-2 md:p-1.5 rounded-md text-content-secondary hover:text-content-primary hover:bg-surface-subtle transition-all duration-150 active:scale-95 touch-manipulation"
            aria-label="设置"
            title="设置"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <SettingsIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  )
}
