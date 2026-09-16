'use client'

import { useEffect, useLayoutEffect, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Plus, Settings, Search, PanelLeftClose, PanelLeftOpen, VenetianMask } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { useInfiniteQuery, useQueryClient, useQuery, type InfiniteData } from '@tanstack/react-query'
import { useChatStore } from '@/store/chat-store'
import { BUILTIN_MASKS } from '@/lib/ai/builtin-masks'
import type { MaskDTO } from '@/lib/ai/mask-types'
import { useSingleFlight } from '@/hooks/useSingleFlight'
import { useUnreadToastNotifier } from '@/hooks/useUnreadToastNotifier'
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
  updatedAt: string
}

interface ConversationsPage {
  items: ConversationData[]
  total: number
  hasMore: boolean
}

const PAGE_SIZE = 20

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
  const router = useRouter()
  const pathname = usePathname()

  const loading = isLoading
  const loadingMore = isFetchingNextPage
  const hasMore = !!hasNextPage

  const handleLoadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return
    fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // Toast on unread change
  useUnreadToastNotifier(conversations)

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
   * Now: always soft-navigate.
   *   1) router.push('/chat') (client navigation, no page reload)
   *   2) We don't actively mutate store here — ChatPanel re-mounts with
   *      initialConversationId=undefined when the new page renders, so
   *      useChat enters "new conversation" mode naturally.
   */
  const handleNewConversation = useSingleFlight(() => {
    setSidebarOpen(false)
    // Always soft navigation; Router-level transition handled by Next.js
    // Even when the current path is /chat/c/[id], this triggers React
    // tree reconciliation rather than a full reload.
    router.push('/chat')
  }, [pathname, router, setSidebarOpen])

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

  const handleDeleteConversation = useCallback(
    async (id: string) => {
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
      } catch (err) {
        console.error('Failed to rename conversation:', err)
      }
    },
    [queryClient]
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
                className={`flex items-center justify-center px-2 py-1.5 rounded-lg transition-all active:scale-[0.98] touch-manipulation
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
                  <button
                    onClick={() => { setSettingsSection('masks'); setSettingsOpen(true); setMaskMenuOpen(false) }}
                    role="menuitem"
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs text-content-muted
                      hover:bg-surface-subtle transition-colors"
                  >
                    <Settings className="w-4 h-4 shrink-0" aria-hidden />
                    <span>管理面具（新增/编辑/删除）</span>
                  </button>
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
            <h2 className="text-[11px] font-medium text-content-muted/80">历史记录</h2>
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
                  {conversations.map((conv, index) => (
                    <ConversationItem
                      key={conv.id}
                      id={conv.id}
                      title={conv.title}
                      mode={conv.mode}
                      index={index}
                      lastMessageAt={new Date(conv.updatedAt).getTime()}
                      onDelete={handleDeleteConversation}
                      onRename={handleRenameConversation}
                    />
                  ))}
                  {hasMore && (
                    <button
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="w-full mt-1 px-3 py-1.5 rounded-lg text-xs text-content-muted hover:text-content-primary hover:bg-surface-subtle/60 transition-colors disabled:opacity-50"
                    >
                      {loadingMore ? '加载中…' : `加载更多 (${total - conversations.length} 条剩余)`}
                    </button>
                  )}
                </>
              )}
            </nav>
          </div>
        )}

        {/* User info region — hidden when collapsed */}
        {sidebarEffectiveOpen && session?.user && (
          <div className="px-2 pt-2 pb-1 flex items-center gap-2 border-t border-line/40 mt-1">
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
          </div>
        )}

        <div className={cn(
          'mt-auto pt-1 pb-2 flex flex-col items-center',
          sidebarEffectiveOpen
            ? 'px-2'
            : 'px-0 border-t border-line/40'
        )}>
          {!sidebarEffectiveOpen && session?.user && (
            session.user.image ? (
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
            )
          )}
          {sidebarEffectiveOpen ? (
            <button
              onClick={() => { setSettingsOpen(true); setSidebarOpen(false) }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-content-secondary hover:text-content-primary hover:bg-surface-subtle/60 transition-all active:scale-[0.98] touch-manipulation"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <Settings className="w-3.5 h-3.5" />
              设置
            </button>
          ) : (
            <button
              onClick={() => { setSettingsOpen(true) }}
              className="p-1.5 rounded-lg text-content-secondary hover:text-content-primary hover:bg-surface-subtle/60 transition-all active:scale-95 touch-manipulation"
              aria-label="设置"
              title="设置"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
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
