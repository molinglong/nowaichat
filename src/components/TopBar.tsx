'use client'

import { Menu, Plus, Sparkles, Scale, MoreHorizontal, Check, MessageSquarePlus, BookOpen, Settings as SettingsIcon } from 'lucide-react'
import { useRouter, usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useChatStore } from '@/store/chat-store'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useIsTauri } from '@/lib/tauri'
import { useStartNewChat } from '@/hooks/useStartNewChat'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { queryKeys, STALE, IMAGES_PAGE_SIZE } from '@/lib/query/keys'
import { fetchJson } from '@/lib/query/fetcher'
import type { ModelDefinition } from '@/lib/ai/types'

type TabKey = 'chat' | 'images' | 'explore'

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
  const [title, setTitle] = useState(conversationTitle)
  // 极窄屏(<381px)折叠菜单的开关
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const pathname = usePathname()
  const queryClient = useQueryClient()

  // 导航过渡状态 —— 点击立刻设上, 导航完成(pathname 更新)清掉.
  const [pendingTab, setPendingTab] = useState<TabKey | null>(null)

  // Update local state when store changes
  useEffect(() => {
    setTitle(conversationTitle)
  }, [conversationTitle])

  // 路由变化时自动关闭折叠菜单 + 清掉 pendingTab
  useEffect(() => {
    setMenuOpen(false)
    setPendingTab(null)
  }, [pathname])

  // 预编译路由 — 让 Next.js 在背景里把目标路由的 RSC chunk / page chunk 下好
  useEffect(() => {
    router.prefetch('/chat')
    router.prefetch('/images')
    router.prefetch('/explore')
  }, [router])

  // ── Tab 数据预热 ────────────────────────────────────────
  // 用户点 tab 之前已经在某些场景下耗时地下载 JS chunk / 拉数据。
  // 提前 prefetch 让切到目标页时 useQuery 走 cache 同步命中,不再 spinner。
  //
  // 关键点:
  // 1. hover 也触发 — 桌面端用户在鼠标进入 tab 的瞬间就把数据备好
  // 2. 每个 tab 都有自己要用的 query key(列表分别预热),不滥用
  // 3. 与 router.prefetch 互补:router prefetch 是下载 RSC chunk,
  //    queryClient.prefetchQuery 是拉服务端数据,二者缺一不可
  const prefetchTabData = useCallback(
    (tab: TabKey) => {
      // 所有 tab 都会用到 providers — 总是预热
      queryClient.prefetchQuery({
        queryKey: queryKeys.providers(),
        queryFn: async () => {
          const payload = await fetchJson<
            | Array<{ id?: string; effectiveModels: ModelDefinition[] }>
            | { providers: Array<{ id?: string; effectiveModels: ModelDefinition[] }> }
          >('/api/providers')
          const list = Array.isArray(payload) ? payload : payload.providers ?? []
          return list.flatMap((p) =>
            p.effectiveModels.map((m): ModelDefinition => ({
              id: m.id,
              name: m.name,
              provider: p.id ?? '',
              contextWindow: m.contextWindow,
              supportsVision: m.supportsVision,
              supportsFiles: m.supportsFiles,
              supportsReasoning: m.supportsReasoning,
            }))
          )
        },
        staleTime: STALE.providers,
      })

      // /chat 新对话页 + /chat/c/[id] 都需要 models — providers 已经覆盖
      // 已有会话的内容由 React Query 的 staleTime(10s)自动管理,不强 prefetch

      if (tab === 'images') {
        // 生图历史列表:生图页主体用本地 state 渲染、首次挂载必拉接口。
        // 这里预热首页数据(生图页拉完也会写回同一 key),切到生图页时
        // 直接从缓存同步回填,不再主区空白 1.5s。
        queryClient.prefetchQuery({
          queryKey: queryKeys.images.list(IMAGES_PAGE_SIZE, 0),
          queryFn: () =>
            fetchJson<{ items?: unknown[]; total?: number }>(
              `/api/images?limit=${IMAGES_PAGE_SIZE}&offset=0`
            ),
          staleTime: STALE.images,
        })

        queryClient.prefetchQuery({
          queryKey: queryKeys.images.settings(),
          queryFn: () =>
            fetchJson<{
              settings?: { imageModel?: string; imageSize?: string }
              builtinModels?: Array<Record<string, unknown>>
              customModels?: Array<Record<string, unknown>>
            }>('/api/image-settings'),
          staleTime: STALE.imageSettings,
        })
      }

      if (tab === 'explore') {
        queryClient.prefetchQuery({
          queryKey: queryKeys.customModels(),
          queryFn: () =>
            fetchJson<ModelDefinition[] | { items?: ModelDefinition[] }>(
              '/api/custom-models'
            ).then((d) => (Array.isArray(d) ? d : d?.items ?? [])),
          staleTime: STALE.customModels,
        })
      }
    },
    [queryClient]
  )

  // 启动时也预热一次,这样首次访问任意页面时 cache 已经在
  useEffect(() => {
    prefetchTabData('chat')
  }, [prefetchTabData])

  // 点击外部关闭折叠菜单
  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  // 在 /images 页面显示固定的页面标题
  const isImagesPage = pathname?.startsWith('/images')
  const isExplorePage = pathname?.startsWith('/explore')
  const isStudyPage = pathname?.startsWith('/study')
  const displayTitle = isImagesPage ? '生图工作台' : isExplorePage ? '观点探索' : isStudyPage ? '错题本' : (title || '新对话')

  // 活跃态
  const isChatActive = (!isImagesPage && !isExplorePage && !isStudyPage) || pendingTab === 'chat'
  const isStudyActive = Boolean(isStudyPage)
  const isImagesActive = Boolean(isImagesPage) || pendingTab === 'images'
  const isExploreActive = Boolean(isExplorePage) || pendingTab === 'explore'

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
      className="relative flex items-center h-9 px-2 shrink-0 m-1.5 rounded-xl border border-line/50 bg-surface-glass backdrop-blur-xl"
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
      <div className="flex items-center gap-0.5 min-w-0 flex-1 max-w-[40%]">
        <button
          onClick={toggleSidebar}
          className="md:hidden shrink-0 p-1.5 -ml-1 rounded-md text-content-secondary hover:text-content-primary hover:bg-surface-subtle transition-colors active:scale-95 touch-manipulation"
          aria-label="打开侧边栏"
          title="打开侧边栏"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <Menu className="w-4 h-4" />
        </button>
        <span className="text-xs font-medium text-content-muted truncate ml-1">
          {displayTitle}
        </span>
      </div>

      {/* Center: 胶囊选项卡 — 绝对居中 */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center pointer-events-none">
        {/* ≥381px: 完整胶囊 */}
        <div className="hidden min-[381px]:flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-subtle/70 pointer-events-auto">
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
          <button
            onClick={handleGoExplore}
            onMouseEnter={() => prefetchTabData('explore')}
            onFocus={() => prefetchTabData('explore')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all duration-150 touch-manipulation',
              isExploreActive
                ? 'bg-surface text-content-primary shadow-sm'
                : 'text-content-secondary hover:text-content-primary active:scale-95'
            )}
            aria-label="观点探索"
            title="观点探索"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <Scale className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">探索</span>
          </button>
          <button
            onClick={() => {
              if (!isStudyActive) router.push('/study')
            }}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all duration-150 touch-manipulation',
              isStudyActive
                ? 'bg-surface text-content-primary shadow-sm'
                : 'text-content-secondary hover:text-content-primary active:scale-95'
            )}
            aria-label="错题本"
            title="错题本"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">错题本</span>
          </button>
        </div>

        {/* <381px: 极窄屏折叠菜单 */}
        <div ref={menuRef} className="min-[381px]:hidden relative pointer-events-auto">
          <button
            onClick={() => setMenuOpen(o => !o)}
            onMouseEnter={() => {
              // 折叠态下预先把三个 tab 的数据都热起来,展开后任意点击都秒开
              prefetchTabData('chat')
              prefetchTabData('images')
              prefetchTabData('explore')
            }}
            className="flex items-center justify-center w-7 h-7 rounded-lg bg-surface-subtle/70 hover:bg-surface-subtle text-content-secondary hover:text-content-primary transition-all active:scale-95 touch-manipulation"
            aria-label="切换页面"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            title="切换页面"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-44 bg-surface border border-line/60 rounded-lg shadow-xl z-50 py-1 overflow-hidden"
            >
              <button
                role="menuitem"
                onClick={handleNewChat}
                onMouseEnter={() => prefetchTabData('chat')}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                  isChatActive
                    ? 'bg-surface-subtle text-content-primary'
                    : 'text-content-secondary hover:bg-surface-subtle hover:text-content-primary'
                )}
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1">聊天</span>
                {isChatActive && <Check className="w-3 h-3 shrink-0 text-accent" />}
              </button>
              <button
                role="menuitem"
                onClick={handleGoImages}
                onMouseEnter={() => prefetchTabData('images')}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                  isImagesActive
                    ? 'bg-surface-subtle text-content-primary'
                    : 'text-content-secondary hover:bg-surface-subtle hover:text-content-primary'
                )}
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1">生图工作台</span>
                {isImagesActive && <Check className="w-3 h-3 shrink-0 text-accent" />}
              </button>
              <button
                role="menuitem"
                onClick={handleGoExplore}
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
                  setMenuOpen(false)
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
      </div>

      {/* Right: 「在新对话继续」按钮(仅在已有具体对话时显示) + 设置(固定最右侧)。
          不设 max-w 上限:flex-1 吸收左侧剩余空间,justify-end 把内容钉在右边缘,
          中间胶囊是绝对定位不受影响 */}
      <div className="flex items-center gap-0.5 min-w-0 flex-1 justify-end">
        {canBranch && (
          <button
            onClick={handleBranchConversation}
            disabled={isBranching}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all duration-150 touch-manipulation shrink-0',
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
        {!isEphemeral && (
          <button
            onClick={() => setSettingsOpen(true)}
            className="shrink-0 inline-flex items-center justify-center p-1.5 rounded-md text-content-secondary hover:text-content-primary hover:bg-surface-subtle transition-all duration-150 active:scale-95 touch-manipulation"
            aria-label="设置"
            title="设置"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <SettingsIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </header>
  )
}
