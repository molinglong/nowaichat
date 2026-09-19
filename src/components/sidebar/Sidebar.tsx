'use client'

import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react'
import type { CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Settings, Search, PanelLeftClose, PanelLeftOpen, VenetianMask, LogOut, User, Glasses } from 'lucide-react'
import { signOut, useSession } from 'next-auth/react'
import { useInfiniteQuery, useQueryClient, useQuery, type InfiniteData } from '@tanstack/react-query'
import { useChatStore } from '@/store/chat-store'
import { BUILTIN_MASKS } from '@/lib/ai/builtin-masks'
import { resolveMaskBadge, type MaskDTO } from '@/lib/ai/mask-types'
import { useSingleFlight } from '@/hooks/useSingleFlight'
import { useStartNewChat } from '@/hooks/useStartNewChat'
// 暂时下线新消息提醒(如需恢复,连同下方调用一起取消注释)
// import { useUnreadToastNotifier } from '@/hooks/useUnreadToastNotifier'
import { useIsTauri } from '@/lib/tauri'
import { TrafficLights } from '@/components/TrafficLights'
import { cn } from '@/lib/utils'
import { ConversationItem } from './ConversationItem'
import { SearchDialog } from './SearchDialog'
import { queryKeys, STALE } from '@/lib/query/keys'
import { fetchJson, HttpError } from '@/lib/query/fetcher'

interface ConversationData {
  id: string
  title: string
  mode?: string
  maskId?: string | null
  updatedAt: string
}

interface ConversationsPage {
  items: ConversationData[]
  total: number
  hasMore: boolean
}

const PAGE_SIZE = 20

/** 滚动到底自动续载哨兵:进入视口(含提前 240px 预载距离)即触发加载下一页,
 * 替代旧的手动「加载更多」按钮,滚动连续无感;加载完成后哨兵仍在视口内会
 * 自动续载下一页直到填满视口。 */
function LoadMoreSentinel({ onVisible, loading }: { onVisible: () => void; loading: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) onVisible()
      },
      { rootMargin: '240px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [onVisible])
  return (
    <div ref={ref} className="py-2 text-center text-[11px] text-content-muted/60">
      {loading ? '加载中…' : ''}
    </div>
  )
}

async function fetchConversationsPage(ctx: {
  pageParam: number
}): Promise<ConversationsPage> {
  const data = await fetchJson<ConversationsPage>(
    `/api/conversations?limit=${PAGE_SIZE}&offset=${ctx.pageParam}`
  )
  return {
    items: data.items ?? [],
    total: data.total ?? 0,
    hasMore: !!data.hasMore,
  }
}

export function Sidebar() {
  const inTauri = useIsTauri()

  const sidebarOpen = useChatStore((s) => s.sidebarOpen)
  const toggleSidebar = useChatStore((s) => s.toggleSidebar)
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen)
  const setSettingsOpen = useChatStore((s) => s.setSettingsOpen)
  const setSettingsSection = useChatStore((s) => s.setSettingsSection)
  const conversationVersion = useChatStore((s) => s.conversationVersion)
  const hydrated = useChatStore((s) => s.hydrated)
  const setHydrated = useChatStore((s) => s.setHydrated)
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const setConversationTitle = useChatStore((s) => s.setConversationTitle)
  const conversationMaskId = useChatStore((s) => s.conversationMaskId)
  const setConversationMaskId = useChatStore((s) => s.setConversationMaskId)
  const removeConversationRead = useChatStore((s) => s.removeConversationRead)
  const queryClient = useQueryClient()

  useLayoutEffect(() => {
    if (!hydrated) {
      setHydrated(true)
      try {
        localStorage.getItem('chat:sidebarOpen')
      } catch {
        // ignore
      }
    }
  }, [hydrated, setHydrated])

  const sidebarEffectiveOpen = hydrated ? sidebarOpen : true
  const { data: session } = useSession()
  // 临时聊天模式(访客密码登录):侧边栏只显示隔离区临时对话,
  // 隐藏账户设置入口;服务端 API 层已同步隔离,此处仅 UX 提示
  const isEphemeral = session?.ephemeral === true

  // 自定义面具列表（面具菜单「我的面具」分组用）
  const { data: userMasks } = useQuery({
    queryKey: queryKeys.masks.list(),
    queryFn: () => fetchJson<MaskDTO[]>('/api/masks'),
    staleTime: STALE.masks,
  })

  // ── Infinite Query: conversation list ─────────────────────────
  // bumpConversationVersion() is called when a new conversation is
  // created / deleted / renamed; we listen for version changes and
  // invalidate to refetch in the background.
  const {
    data,
    isLoading,
    isPending,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery<
    ConversationsPage,
    HttpError,
    InfiniteData<ConversationsPage, number>,
    readonly unknown[],
    number
  >({
    queryKey: queryKeys.conversations.list(PAGE_SIZE, 0),
    queryFn: async ({ pageParam }) =>
      fetchConversationsPage({ pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined
      // Sum across already-loaded pages
      return allPages.reduce((acc, p) => acc + p.items.length, 0)
    },
    staleTime: STALE.conversationList,
  })

  // bumpConversationVersion() triggers invalidate so a refetch happens
  useEffect(() => {
    if (conversationVersion === 0) return
    queryClient.invalidateQueries({ queryKey: queryKeys.conversations.list(PAGE_SIZE, 0) })
  }, [conversationVersion, queryClient])

  const conversations: ConversationData[] = (data?.pages ?? []).flatMap((p) => p.items)
  const total = data?.pages?.[0]?.total ?? 0
  const [searchOpen, setSearchOpen] = useState(false)
  // 面具选择菜单(仅在展开态渲染,折叠态点击先展开侧边栏)
  const [maskMenuOpen, setMaskMenuOpen] = useState(false)
  // 用户菜单(底部头像/用户行点击弹出:账号设置入口 + 退出登录)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const router = useRouter()

  const loading = isLoading || isPending
  const loadingMore = isFetchingNextPage
  const hasMore = !!hasNextPage

  const handleLoadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return
    fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // Toast on unread change
  // 暂时下线新消息提醒(恢复时取消注释,并恢复顶部 import)
  // useUnreadToastNotifier(conversations)

  // Cmd/Ctrl + K opens the search dialog
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /**
   * Fixed: hard reload removed.
   *
   * Previously, when pathname === '/chat' but window.location had been
   * rewritten to /chat/c/[id], we forced `window.location.href = '/chat'`
   * which triggered a full page reload — Sidebar/TopBar rebuilt, fonts
   * re-downloaded, store rehydrated. Perceived as "a hitch".
   *
   * Now: startNewChat (see useStartNewChat for why a bare router.push
   * is not enough — replaceState-made URLs make Next.js reuse the same
   * page subtree, or no-op entirely when already on /chat).
   * ChatPanel re-mounts with a fresh key when the new page renders,
   * so useChat enters "new conversation" mode deterministically.
   */
  const startNewChat = useStartNewChat()
  const handleNewConversation = useSingleFlight(() => {
    // 移动端(<md)侧边栏是 fixed 浮层,点完「新对话」要收回才能看到聊天区;
    // 桌面端侧边栏静态占位,保持用户当前的开合状态,不折叠。
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches) {
      setSidebarOpen(false)
    }
    startNewChat()
  }, [setSidebarOpen, startNewChat])

  // 选面具开新对话:写入 store + localStorage,复用单飞导航。
  // ChatPanel 挂载后会从 localStorage 恢复,首条消息发送时服务端将 maskId 写入会话。
  const handleSelectMask = useCallback(
    (maskId: string | null) => {
      setConversationMaskId(maskId)
      if (maskId) {
        localStorage.setItem('chat:maskId', maskId)
      } else {
        localStorage.removeItem('chat:maskId')
      }
      setMaskMenuOpen(false)
      handleNewConversation()
    },
    [setConversationMaskId, handleNewConversation]
  )

  // 折叠态点面具图标:先展开侧边栏再弹菜单(菜单在展开态渲染,避免被 aside overflow 裁剪)
  const handleMaskButtonInCollapsed = useCallback(() => {
    setSidebarOpen(true)
    setMaskMenuOpen(true)
  }, [setSidebarOpen])

  // 折叠态点头像:先展开侧边栏再弹菜单(菜单在展开态渲染,避免被 aside overflow 裁剪)
  const handleAvatarInCollapsed = useCallback(() => {
    setSidebarOpen(true)
    setUserMenuOpen(true)
  }, [setSidebarOpen])

  // 用户菜单 → 打开设置弹窗并定位到「账号信息」
  const handleOpenAccountSettings = useCallback(() => {
    setUserMenuOpen(false)
    setSettingsSection('account')
    setSettingsOpen(true)
  }, [setSettingsSection, setSettingsOpen])

  // 用户菜单 → 退出登录
  const handleSignOut = useCallback(async () => {
    setUserMenuOpen(false)
    await signOut({ callbackUrl: '/login' })
  }, [])

  // 用户菜单:点击外部或 Esc 关闭。不用 fixed 遮罩——aside 的 backdrop-blur/transform
  // 会使 fixed 相对 aside 而非视口定位,遮罩罩不住主内容区
  useEffect(() => {
    if (!userMenuOpen) return
    function onPointerDown(e: PointerEvent) {
      const el = e.target as HTMLElement | null
      if (el?.closest('[data-user-menu-root]')) return
      setUserMenuOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setUserMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [userMenuOpen])

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      // 二次确认:防止误点垃圾桶图标直接删除不可恢复的对话
      if (!confirm('确定要删除这个对话吗？删除后不可恢复。')) return
      try {
        await fetchJson(`/api/conversations/${id}`, { method: 'DELETE' })
        // Directly remove from cache, avoiding an extra refetch
        queryClient.setQueryData<InfiniteData<ConversationsPage, number> | undefined>(
          queryKeys.conversations.list(PAGE_SIZE, 0),
          (prev) => {
            if (!prev) return prev
            return {
              ...prev,
              pages: prev.pages.map((p) => ({
                ...p,
                items: p.items.filter((c) => c.id !== id),
                total: Math.max(0, p.total - 1),
              })),
            }
          }
        )
        removeConversationRead(id)
        if (currentConversationId === id) {
          router.push('/chat')
        }
      } catch (err) {
        console.error('Failed to delete conversation:', err)
      }
    },
    [queryClient, removeConversationRead, currentConversationId, router]
  )

  const handleRenameConversation = useCallback(
    async (id: string, newTitle: string) => {
      try {
        await fetchJson(`/api/conversations/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          json: { title: newTitle },
        })
        // Optimistic: update cache immediately
        queryClient.setQueryData<InfiniteData<ConversationsPage, number> | undefined>(
          queryKeys.conversations.list(PAGE_SIZE, 0),
          (prev) => {
            if (!prev) return prev
            return {
              ...prev,
              pages: prev.pages.map((p) => ({
                ...p,
                items: p.items.map((c) =>
                  c.id === id ? { ...c, title: newTitle } : c
                ),
              })),
            }
          }
        )
        // 同步会话详情缓存，否则正在浏览的会话页顶栏标题不同步
        queryClient.setQueryData<
          | { id: string; title: string; [key: string]: unknown }
          | undefined
        >(queryKeys.conversations.detail(id), (prev) =>
          prev ? { ...prev, title: newTitle } : prev
        )
        // 新对话页(history.replaceState 后未导航到 /chat/c/[id])没有详情查询,
        // 顶栏标题由 store 驱动，直接同步
        if (currentConversationId === id) {
          setConversationTitle(newTitle)
        }
      } catch (err) {
        console.error('Failed to rename conversation:', err)
      }
    },
    [queryClient, currentConversationId, setConversationTitle]
  )

  return (
    <>
      {/* Mobile overlay backdrop — not needed on tablets and above */}
      {sidebarEffectiveOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-1.5 bottom-1.5 left-1.5 z-50 w-56 flex flex-col',
          // pb-[var(--sab)]: PWA 全屏模式下列表底部让出 Home Indicator 安全区(浏览器内为 0)
          'pb-[var(--sab)]',
          'bg-surface-glass backdrop-blur-xl text-content-primary',
          'rounded-xl border border-line/50 overflow-hidden',
          'transition-transform duration-300 ease-in-out',
          'm-1.5',
          sidebarEffectiveOpen ? 'translate-x-0' : '-translate-x-full',
          // Tablets and above: always static (taking layout space)
          'md:static md:z-auto md:inset-auto md:translate-x-0 md:m-1.5 md:transition-all',
          // Collapsed on desktop: shrink to a narrow icon bar
          !sidebarEffectiveOpen && 'md:w-12'
        )}
      >
        <div
          className={cn(
            'flex items-center pt-3 pb-1.5',
            sidebarEffectiveOpen ? 'justify-between gap-2 px-3' : 'justify-center px-0'
          )}
          {...(inTauri && sidebarEffectiveOpen
            ? {
                'data-tauri-drag-region': '',
                style: { WebkitAppRegion: 'drag' } as React.CSSProperties,
                onDoubleClick: () => {
                  import('@/lib/tauri').then(({ tauri }) => tauri.toggleMaximize())
                },
              }
            : {})}
        >
          {inTauri && sidebarEffectiveOpen && <TrafficLights />}
          {sidebarEffectiveOpen ? (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <h1 className="text-base font-semibold tracking-tight truncate">八号产房</h1>
            </div>
          ) : (
            <button
              onClick={toggleSidebar}
              className="p-1 rounded-md hover:bg-surface-subtle transition-all active:scale-95 touch-manipulation"
              aria-label="展开侧边栏"
              title="展开侧边栏"
              style={{ WebkitTapHighlightColor: 'transparent', WebkitAppRegion: 'no-drag' } as CSSProperties}
            >
              <PanelLeftOpen className="w-3.5 h-3.5 text-content-secondary" />
            </button>
          )}
          {sidebarEffectiveOpen && (
            <button
              onClick={toggleSidebar}
              className="p-1 rounded-md hover:bg-surface-subtle transition-all active:scale-95 touch-manipulation"
              aria-label="收起侧边栏"
              title="收起侧边栏"
              style={{ WebkitTapHighlightColor: 'transparent', WebkitAppRegion: 'no-drag' } as CSSProperties}
            >
              <PanelLeftClose className="w-3.5 h-3.5 text-content-secondary" />
            </button>
          )}
        </div>

        {/* 临时聊天模式标识条(中性灰极简风):明确当前处于隔离区 */}
        {sidebarEffectiveOpen && isEphemeral && (
          <div className="mx-3 mt-1 mb-0.5 px-2.5 py-1.5 rounded-lg bg-surface-subtle/70 border border-line/40">
            <p className="text-[11px] font-medium text-content-secondary flex items-center gap-1.5">
              <Glasses className="w-3 h-3 shrink-0" aria-hidden />
              临时聊天
            </p>
            <p className="mt-0.5 text-[10px] leading-4 text-content-muted">
              对话已隔离保存，可在正常模式 设置→账号信息 中找回
            </p>
          </div>
        )}
        {!sidebarEffectiveOpen && isEphemeral && (
          <div className="flex justify-center pt-1" title="临时聊天模式">
            <Glasses className="w-3.5 h-3.5 text-content-muted" aria-label="临时聊天模式" />
          </div>
        )}

        {!sidebarEffectiveOpen && (
          <div className="flex flex-col items-center gap-1 pt-2">
            <button
              onClick={handleNewConversation}
              className="p-2 rounded-lg text-content-secondary hover:text-content-primary hover:bg-surface-subtle/60 transition-all active:scale-95 touch-manipulation"
              aria-label="新对话"
              title="新对话"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={handleMaskButtonInCollapsed}
              className="p-2 rounded-lg text-content-secondary hover:text-content-primary hover:bg-surface-subtle/60 transition-all active:scale-95 touch-manipulation"
              aria-label="用面具开新对话"
              title="用面具开新对话"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <VenetianMask className="w-4 h-4" />
            </button>
            <button
              onClick={() => setSearchOpen(true)}
              className="p-2 rounded-lg text-content-secondary hover:text-content-primary hover:bg-surface-subtle/60 transition-all active:scale-95 touch-manipulation"
              aria-label="搜索聊天记录"
              title="搜索 (⌘K / Ctrl+K)"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <Search className="w-4 h-4" />
            </button>
          </div>
        )}

        {sidebarEffectiveOpen && (
          <div className="px-2 pt-1.5 pb-3 relative">
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleNewConversation}
                className="flex-1 flex items-center justify-start gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                  bg-surface-subtle text-content-primary
                  hover:bg-surface-muted transition-all active:scale-[0.98] touch-manipulation"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <Plus className="w-3.5 h-3.5" />
                新对话
              </button>
              <button
                onClick={() => setMaskMenuOpen((v) => !v)}
                className={`flex h-8 items-center justify-center px-2 rounded-lg transition-all active:scale-[0.98] touch-manipulation
                  ${maskMenuOpen || conversationMaskId
                    ? 'bg-surface-muted text-content-primary'
                    : 'bg-surface-subtle text-content-secondary hover:bg-surface-muted hover:text-content-primary'}`}
                aria-label="用面具开新对话"
                title="用面具开新对话"
                aria-expanded={maskMenuOpen}
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <VenetianMask className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 面具菜单:纯色浮层(遵循弹窗纯色背景规范),向下弹出 */}
            {maskMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMaskMenuOpen(false)} />
                <div
                  className="absolute left-2 top-full -mt-1.5 z-50 w-[13rem] max-h-72 overflow-y-auto
                    rounded-xl border border-line bg-surface shadow-lg py-1.5"
                  role="menu"
                >
                  <div className="px-3 py-1 text-[10px] font-medium text-content-muted/70 uppercase tracking-wide">
                    选择面具开新对话
                  </div>
                  {BUILTIN_MASKS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => handleSelectMask(m.id)}
                      role="menuitem"
                      className={`w-full flex items-start gap-2.5 px-3 py-1.5 text-left transition-colors
                        ${m.id === conversationMaskId ? 'bg-surface-muted' : 'hover:bg-surface-subtle'}`}
                    >
                      <span className="text-base leading-5 shrink-0" aria-hidden>{m.avatar}</span>
                      <span className="min-w-0">
                        <span className="block text-xs font-medium text-content-primary">{m.name}</span>
                        <span className="block text-[11px] text-content-muted truncate">{m.description}</span>
                      </span>
                    </button>
                  ))}
                  {(userMasks?.length ?? 0) > 0 && (
                    <>
                      <div className="px-3 pt-2 pb-1 text-[10px] font-medium text-content-muted/70 uppercase tracking-wide">
                        我的面具
                      </div>
                      {(userMasks ?? []).map((m) => (
                        <button
                          key={m.id}
                          onClick={() => handleSelectMask(m.id)}
                          role="menuitem"
                          className={`w-full flex items-start gap-2.5 px-3 py-1.5 text-left transition-colors
                            ${m.id === conversationMaskId ? 'bg-surface-muted' : 'hover:bg-surface-subtle'}`}
                        >
                          <span className="text-base leading-5 shrink-0" aria-hidden>{m.avatar}</span>
                          <span className="min-w-0">
                            <span className="block text-xs font-medium text-content-primary">{m.name}</span>
                            <span className="block text-[11px] text-content-muted truncate">{m.description}</span>
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                  <div className="my-1 border-t border-line" />
                  {/* 临时模式隐藏面具管理入口(写操作已被服务端拦截) */}
                  {!isEphemeral && (
                    <button
                      onClick={() => { setSettingsSection('masks'); setSettingsOpen(true); setMaskMenuOpen(false) }}
                      role="menuitem"
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs text-content-muted
                        hover:bg-surface-subtle transition-colors"
                    >
                      <Settings className="w-4 h-4 shrink-0" aria-hidden />
                      <span>管理面具（新增/编辑/删除）</span>
                    </button>
                  )}
                  <button
                    onClick={() => handleSelectMask(null)}
                    role="menuitem"
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs text-content-muted
                      hover:bg-surface-subtle transition-colors"
                  >
                    <span className="text-base leading-5" aria-hidden>✕</span>
                    <span>不带面具开新对话</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {sidebarEffectiveOpen && (
          <div className="px-3.5 pt-2 pb-1 flex items-center justify-between">
            <h2 className="text-[11px] font-medium text-content-muted/80">
              {isEphemeral ? '临时对话' : '历史记录'}
            </h2>
            <div className="flex items-center gap-1.5">
              {total > 0 && (
                <span className="text-[11px] text-content-muted/60 tabular-nums">
                  {conversations.length}
                  {hasMore ? ` / ${total}` : ''}
                </span>
              )}
              <button
                onClick={() => setSearchOpen(true)}
                className="p-0.5 -mr-1 rounded-md text-content-muted/70 hover:text-content-primary hover:bg-surface-subtle transition-all active:scale-95"
                aria-label="搜索聊天记录"
                title="搜索 (⌘K / Ctrl+K)"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {sidebarEffectiveOpen && (
          <div className="flex-1 overflow-y-auto px-1.5 pt-0.5">
            <nav className="space-y-0.5">
              {loading && !data ? (
                <div className="px-3 py-6 text-center text-content-muted text-xs">
                  加载中…
                </div>
              ) : conversations.length === 0 ? (
                <div className="px-3 py-6 text-center text-content-muted text-xs">
                  暂无对话记录
                </div>
              ) : (
                <>
                  {conversations.map((conv, index) => {
                    const badge = resolveMaskBadge(conv.maskId, userMasks)
                    return (
                      <ConversationItem
                        key={conv.id}
                        id={conv.id}
                        title={conv.title}
                        mode={conv.mode}
                        maskAvatar={badge?.avatar}
                        maskName={badge?.name}
                        index={index}
                        lastMessageAt={new Date(conv.updatedAt).getTime()}
                        onDelete={handleDeleteConversation}
                        onRename={handleRenameConversation}
                      />
                    )
                  })}
                  {hasMore && (
                    <LoadMoreSentinel onVisible={handleLoadMore} loading={loadingMore} />
                  )}
                </>
              )}
            </nav>
          </div>
        )}

        {/* User info region — hidden when collapsed */}
        {sidebarEffectiveOpen && session?.user && (
          <div
            className="relative px-2 pt-2 pb-2 mt-1 border-t border-line/40"
            data-user-menu-root
          >
            <div className="flex items-center gap-0.5">
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              className="min-w-0 flex-1 flex items-center gap-2 px-1.5 py-1 rounded-lg text-left
                hover:bg-surface-subtle/60 transition-colors touch-manipulation"
              aria-label="账号菜单"
              aria-expanded={userMenuOpen}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              {session.user.image ? (
                <img
                  src={session.user.image}
                  alt={session.user.name || '头像'}
                  className="w-7 h-7 rounded-full shrink-0 object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-[11px] font-medium text-accent shrink-0">
                  {(session.user.name || session.user.email || '?').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-content-primary truncate">
                  {session.user.name || session.user.email || '已登录'}
                </p>
                {session.user.email && session.user.name && (
                  <p className="text-[10px] text-content-muted truncate">
                    {session.user.email}
                  </p>
                )}
              </div>
            </button>
            {/* 快捷设置入口:免两跳直达设置面板(临时模式隐藏,与菜单内账号设置显隐一致) */}
            {!isEphemeral && (
              <button
                onClick={() => { setUserMenuOpen(false); setSettingsOpen(true) }}
                className="shrink-0 p-1.5 rounded-md text-content-secondary hover:text-content-primary hover:bg-surface-subtle transition-all active:scale-95 touch-manipulation"
                aria-label="设置"
                title="设置"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <Settings className="w-3.5 h-3.5" aria-hidden />
              </button>
            )}
            </div>

            {/* 用户菜单:纯色浮层(遵循弹窗纯色背景规范),向上弹出 */}
            {userMenuOpen && (
              <div
                className="absolute left-2 bottom-full mb-1.5 z-50 w-[13rem]
                  rounded-xl border border-line bg-surface shadow-lg py-1.5"
                role="menu"
              >
                <div className="px-3 py-2 flex items-center gap-2.5">
                  {session.user.image ? (
                    <img
                      src={session.user.image}
                      alt={session.user.name || '头像'}
                      className="w-9 h-9 rounded-full shrink-0 object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center text-sm font-medium text-accent shrink-0">
                      {(session.user.name || session.user.email || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-content-primary truncate">
                      {session.user.name || '已登录'}
                    </p>
                    {session.user.email && (
                      <p className="text-[11px] text-content-muted truncate">
                        {session.user.email}
                      </p>
                    )}
                  </div>
                </div>
                <div className="my-1 border-t border-line" />
                {/* 临时模式隐藏账号设置入口(账户管理写操作已被服务端拦截) */}
                {!isEphemeral && (
                  <button
                    onClick={handleOpenAccountSettings}
                    role="menuitem"
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs text-content-secondary
                      hover:bg-surface-subtle transition-colors"
                  >
                    <User className="w-4 h-4 shrink-0" aria-hidden />
                    <span>账号设置</span>
                  </button>
                )}
                <button
                  onClick={handleSignOut}
                  role="menuitem"
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs text-red-500/70
                    hover:text-red-500 hover:bg-surface-subtle transition-colors"
                >
                  <LogOut className="w-4 h-4 shrink-0" aria-hidden />
                  <span>退出登录</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* 底部:折叠态头像(点击展开侧边栏并弹出账号菜单) */}
        {!sidebarEffectiveOpen && session?.user && (
          <div className="mt-auto pt-1 pb-2 px-0 border-t border-line/40 flex flex-col items-center">
            <button
              onClick={handleAvatarInCollapsed}
              className="rounded-full transition-all active:scale-95 touch-manipulation"
              aria-label="展开侧边栏并打开账号菜单"
              title="账号"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              {session.user.image ? (
                <img
                  src={session.user.image}
                  alt={session.user.name || '头像'}
                  className="w-7 h-7 rounded-full shrink-0 object-cover mb-1.5"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-[11px] font-medium text-accent shrink-0 mb-1.5">
                  {(session.user.name || session.user.email || '?').charAt(0).toUpperCase()}
                </div>
              )}
            </button>
          </div>
        )}
      </aside>

      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(id) => {
          setSearchOpen(false)
          setSidebarOpen(false)
          router.push(`/chat/c/${id}`)
        }}
      />
    </>
  )
}
