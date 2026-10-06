'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, ChevronRight, Search } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query'
import { useChatStore } from '@/store/chat-store'
import { usePageNav } from '@/hooks/usePageNav'
import { queryKeys, STALE } from '@/lib/query/keys'
import { fetchJson, HttpError } from '@/lib/query/fetcher'
import { resolveMaskBadge, type MaskDTO } from '@/lib/ai/mask-types'
import { SearchDialog } from '@/components/sidebar/SearchDialog'
import { relativeTime } from '@/components/chat/RecentChats'
import { useIsMobileViewport } from '@/hooks/useIsMobileViewport'
import { useBackToClose } from '@/hooks/useBackToClose'
import { cn } from '@/lib/utils'

/**
 * 方案 C 手机端全屏抽屉(≤md,V2 大字导航版)—— 移动端唯一导航入口。
 *
 * 设计稿定稿形态:全屏毛玻璃(surface/.86 + blur 28)+ 级联入场;
 * 顶部 AICHATT 品牌字 + ✕ 圆钮;01-05 编号 + 24px 大字导航(选中琥珀);
 * 分隔线下「最近 · N / 总数」历史行(标题 + 相对时间);底部用户行(点头像行进账号设置)。
 *
 * 状态复用 chat-store 的 sidebarOpen(与桌面侧栏同一开关,localStorage 记忆):
 * 浮钮 ☰ toggleSidebar 打开的就是它。桌面端不渲染——aside 本体在 ≥md 仍是原侧栏。
 * 关闭动画:开启 = 双 RAF 后加 .open(transform 过渡);关闭 = 先落 .open 再卸载。
 */

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

/** 触底续载哨兵(与桌面侧栏 Sidebar 的 LoadMoreSentinel 同一形态):
 * 进入视口前 240px 就取下一页,加载完哨兵仍在视口内会继续触发,直到铺满。 */
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

export function MobileDrawer() {
  const sidebarOpen = useChatStore((s) => s.sidebarOpen)
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen)
  const setSettingsOpen = useChatStore((s) => s.setSettingsOpen)
  const setSettingsSection = useChatStore((s) => s.setSettingsSection)
  const conversationVersion = useChatStore((s) => s.conversationVersion)
  const router = useRouter()
  const { items: navItems, isEphemeral } = usePageNav()
  const { data: session } = useSession()
  const isMobile = useIsMobileViewport()

  // 入场/退场动画状态机:rendered=true 期间 DOM 存在;open 由双 RAF 置 true 触发过渡
  const [rendered, setRendered] = useState(false)
  const [open, setOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // armed:首个 effect 跑完前不渲染 —— 避免移动端首帧用「桌面默认展开」的 sidebarOpen 弹开抽屉
  const [armed, setArmed] = useState(false)

  // 移动视口下进入即收起一次(桌面侧栏默认展开,移动端抽屉默认关闭;
  // sidebarOpen 是两端共用的持久化开关,移动端每次进入都从「关」起步)
  useEffect(() => {
    if (isMobile && sidebarOpen) setSidebarOpen(false)
    setArmed(true)
    // 仅在视口特性变化时重置;用户之后的开合不受影响
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile])

  useEffect(() => {
    if (!armed) return
    if (sidebarOpen) {
      setRendered(true)
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setOpen(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        if (raf2) cancelAnimationFrame(raf2)
      }
    }
    // 关闭:先退场(transitionend 由兜底计时收尾),再卸载
    setOpen(false)
    if (!rendered) return
    const timer = window.setTimeout(() => setRendered(false), 340)
    return () => window.clearTimeout(timer)
  }, [sidebarOpen, rendered, armed])

  // Esc 关闭(设计稿交互);抽屉开着时拦截,避免同时触发底层弹层
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, setSidebarOpen])

  // 系统/浏览器「返回」先收抽屉:抽屉不占路由,而壳内返回键固定走 WebView goBack
  useBackToClose(isMobile && open, () => setSidebarOpen(false))

  // 会话历史:与 Sidebar 同 queryKey 共享缓存(bump 版本联动刷新),无额外请求
  const {
    data,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery<ConversationsPage, HttpError, InfiniteData<ConversationsPage, number>, readonly unknown[], number>({
    queryKey: queryKeys.conversations.list(PAGE_SIZE, 0),
    queryFn: async ({ pageParam }) => {
      const d = await fetchJson<ConversationsPage>(`/api/conversations?limit=${PAGE_SIZE}&offset=${pageParam}`)
      return { items: d.items ?? [], total: d.total ?? 0, hasMore: !!d.hasMore }
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.reduce((acc, p) => acc + p.items.length, 0) : undefined,
    staleTime: STALE.conversationList,
    enabled: rendered && isEphemeral !== true,
  })

  // 面具徽章(历史行头像)
  const { data: userMasks } = useQuery({
    queryKey: queryKeys.masks.list(),
    queryFn: () => fetchJson<MaskDTO[]>('/api/masks'),
    staleTime: STALE.masks,
    enabled: rendered && isEphemeral !== true,
  })

  // 触底续载:抽屉历史列表原来只挂了第一页 20 条就断了 —— queryKey 与 Sidebar 共用
  // 同一份缓存,但 Sidebar 的哨兵在桌面侧栏里,移动视口看不见,必须自己带一个。
  const handleLoadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return
    fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (!armed || !rendered) return null

  const conversations = (data?.pages ?? []).flatMap((p) => p.items)
  const total = data?.pages?.[0]?.total ?? 0
  const user = session?.user

  const close = () => setSidebarOpen(false)

  // 级联入场延迟(与原型一致 0.02 起步逐项递增)
  const d = (i: number) => ({ ['--d' as string]: `${i}s` }) as React.CSSProperties

  return (
    <>
      {/* 全屏抽屉本层:玻璃面板(inset-0),transform 过渡;条目级联用 .mdr-st + --d */}
      <aside
        aria-label="导航抽屉"
        className={cn(
          'mdrawer md:hidden fixed inset-0 z-50 flex flex-col overflow-hidden',
          'bg-surface-muted/85 text-content-primary',
          'transition-transform duration-[340ms] ease-[cubic-bezier(.32,.72,.28,1)]',
          open ? 'translate-x-0 mdrawer-open' : '-translate-x-full'
        )}
        style={{
          WebkitBackdropFilter: 'blur(28px)',
          backdropFilter: 'blur(28px)',
          paddingBottom: 'max(var(--sab, 0px), 8px)',
        }}
      >
        {/* 顶部:品牌字 + 搜索 + 关闭(行顶/右内缩与浮钮簇同一条 --m-chrome 基线,
            抽屉是 fixed inset-0,所以直接吃同一变量就能与 ⚙ 原位重合) */}
        <div className="mdr-st shrink-0 flex items-center justify-between pl-6 pr-[var(--m-chrome-inset)] pt-[var(--m-chrome-top)]" style={d(0.02)}>
          <span className="text-xs font-bold tracking-[0.18em] text-content-muted">AICHATT</span>
          <div className="flex items-center gap-[var(--m-chrome-gap)]">
            {!isEphemeral && (
              <button
                onClick={() => { close(); setSearchOpen(true) }}
                className="flex items-center justify-center w-10 h-10 rounded-full border border-line/80 bg-surface/70 text-content-secondary active:scale-90 transition-transform touch-manipulation"
                aria-label="搜索聊天记录"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <Search className="w-[18px] h-[18px]" />
              </button>
            )}
            <button
              onClick={close}
              className="flex items-center justify-center w-10 h-10 rounded-full border border-line/80 bg-surface/70 text-content-secondary active:scale-90 transition-transform touch-manipulation"
              aria-label="关闭"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <X className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>

        {/* 01-05 大字导航(头部行下沉 42px,这里把上边距收回来,首条目测位置基本不动) */}
        <nav className="mt-1 flex flex-col px-6">
          {navItems.map((item, i) => (
            <button
              key={item.key}
              onClick={() => { close(); item.onClick() }}
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                'mdr-st flex items-baseline gap-4 py-2 text-left text-2xl leading-[1.2] font-medium transition-colors active:translate-x-0.5 touch-manipulation',
                item.active ? 'text-accent font-semibold' : 'text-content-primary/50'
              )}
              style={d(0.06 + i * 0.04)}
            >
              <span className={cn('w-[26px] flex-none text-[11px] font-semibold tracking-[0.05em] tabular-nums', item.active ? 'text-accent/80' : 'text-content-muted/80')}>
                {String(i + 1).padStart(2, '0')}
              </span>
              {item.label}
            </button>
          ))}
        </nav>

        {/* 分隔线 + 最近历史 */}
        {!isEphemeral && (
          <>
            <div className="mdr-st mx-6 mt-4 border-t border-line/90" style={d(0.26)} />
            <p className="mdr-st px-6 pb-2 pt-3 text-[10.5px] tracking-[0.14em] text-content-muted" style={d(0.28)}>
              最近 · {conversations.length}{total > conversations.length ? ` / ${total}` : ''}
            </p>
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {conversations.length === 0 ? (
                <p className="mdr-st py-6 text-center text-xs text-content-muted" style={d(0.3)}>暂无对话记录</p>
              ) : (
                <>
                  {conversations.map((conv, i) => {
                    const badge = resolveMaskBadge(conv.maskId, userMasks)
                    return (
                      <button
                        key={conv.id}
                        onClick={() => { close(); router.push(`/chat/c/${conv.id}`) }}
                        className="mdr-st flex w-full items-center gap-2.5 py-2 text-left active:opacity-70 transition-opacity touch-manipulation"
                        /* 首屏条目走级联入场;续载进来的(第 2 页起)不再延迟,
                           否则触底后要空等 0.5s 才露面 */
                        style={d(i < PAGE_SIZE ? Math.min(0.3 + i * 0.02, 0.5) : 0)}
                      >
                        {/* 面具 emoji 只在真的挂了面具时出现;原先无面具兜底 💬,
                            整列表被同一枚消息 emoji 刷屏,已按用户定案撤掉 */}
                        {badge && (
                          <span className="flex-none text-base leading-5" aria-hidden>{badge.avatar}</span>
                        )}
                        <span className="min-w-0 flex-1 truncate text-[13.5px] text-content-secondary">
                          {conv.title || '未命名对话'}
                        </span>
                        <span className="flex-none text-[10.5px] text-content-muted" suppressHydrationWarning>
                          {relativeTime(conv.updatedAt)}
                        </span>
                      </button>
                    )
                  })}
                  <LoadMoreSentinel onVisible={handleLoadMore} loading={isFetchingNextPage} />
                </>
              )}
            </div>

            {/* 底部用户行 → 账号设置 */}
            {user && (
              <button
                onClick={() => { close(); setSettingsSection('account'); setSettingsOpen(true) }}
                className="mdr-st mx-4 mb-1 flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left active:bg-surface-subtle/60 transition-colors touch-manipulation"
                style={d(0.42)}
              >
                {user.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.image} alt="" className="h-9 w-9 flex-none rounded-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
                    {(user.name || user.email || '?').charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-content-primary">{user.name || '已登录'}</span>
                  {user.email && <span className="block truncate text-[10.5px] text-content-muted">{user.email}</span>}
                </span>
                <ChevronRight className="h-4 w-4 flex-none text-content-muted" />
              </button>
            )}
          </>
        )}
      </aside>

      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(id) => {
          setSearchOpen(false)
          close()
          router.push(`/chat/c/${id}`)
        }}
      />
    </>
  )
}
