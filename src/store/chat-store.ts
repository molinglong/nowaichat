import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand'
import {
  loadDrafts,
  type DraftEntry,
  type DraftsMap,
} from '@/lib/draft-storage'
import {
  loadLastReadAt,
  persistLastReadAt,
  removeLastReadAt,
} from '@/lib/last-read'

/** 最近使用模型历史上限:超过此值的最旧条目会被淘汰 */
const MAX_RECENT_MODELS = 10

/** 从 localStorage 读取字符串数组,失败/缺失返回 fallback */
function loadStringArray(key: string, fallback: string[] = []): string[] {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : fallback
  } catch {
    return fallback
  }
}

interface ChatState {
  sidebarOpen: boolean
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  /** 客户端是否已完成 hydrate. 只在第一次客户端渲染完成后翻为 true,
   *  跨 layout 跳转时 Sidebar 重新挂载但 hydrated 仍为 true, 避免 "先展开再收起" 闪烁. */
  hydrated: boolean
  setHydrated: (v: boolean) => void
  currentConversationId: string | null
  setCurrentConversationId: (id: string | null) => void
  conversationTitle: string | null
  setConversationTitle: (title: string | null) => void
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  /** 打开设置弹窗时指定的目标 section（如 'masks'）；消费后置 null */
  settingsSection: string | null
  setSettingsSection: (section: string | null) => void
  previewCode: string | null
  setPreviewCode: (code: string | null) => void
  isPreviewFullscreen: boolean
  setIsPreviewFullscreen: (fullscreen: boolean) => void
  /** 会话列表刷新信号：新会话创建时 +1，侧边栏监听此值重新拉取列表 */
  conversationVersion: number
  bumpConversationVersion: () => void
  /** 当前对话的风格预设 id(balanced/practical/dev/editor/mentor/scholar). 默认 balanced. */
  conversationStylePreset: string
  setConversationStylePreset: (preset: string) => void
  /** 当前对话的面具 id(内置面具见 @/lib/ai/builtin-masks). null 表示未启用面具. */
  conversationMaskId: string | null
  setConversationMaskId: (maskId: string | null) => void
  /** 当前联网搜索引擎：qianfan | tavily，默认 qianfan */
  searchEngine: 'qianfan' | 'tavily'
  setSearchEngine: (engine: 'qianfan' | 'tavily') => void
  /** 输入草稿:按会话 key 索引. SSR 期间为空,客户端 hydrate 后从 localStorage 灌入 */
  drafts: DraftsMap
  /** 设置某个会话的草稿(null 表示删除) */
  setDraft: (convKey: string, entry: DraftEntry | null) => void
  /** 从 localStorage 重新加载(供跨 tab storage 事件触发) */
  reloadDrafts: () => void
  /** 接着说:用户点了 ⏹ 后保存到 store,ChatInput 顶部横幅可一键恢复 */
  pendingContinuation: { conversationId: string | null; text: string; modelId: string } | null
  setPendingContinuation: (
    p: { conversationId: string | null; text: string; modelId: string } | null
  ) => void
  /** 已读时间:按会话 ID 索引,持久化到 localStorage.
   *  在 store 里维护是为了让 ConversationItem 在不同时间点能一致地读同一个值
   *  (避免每个组件各自读 localStorage 出现 SSR/CSR 不一致). */
  lastReadAt: Record<string, number>
  /** 把指定会话标为"已读当下",写入 store + localStorage.
   *  debounced 防抖由调用方负责(避免快速切换闪烁). */
  markConversationRead: (conversationId: string) => void
  /** 删除会话时同步清理已读记录 */
  removeConversationRead: (conversationId: string) => void
  /** 键盘导航(j/k)选中的消息 ID,null 表示未选中任何消息 */
  focusedMessageId: string | null
  setFocusedMessageId: (id: string | null) => void
  /** 引用回复:被引用的消息(显示在 ChatInput 顶部横幅),null 表示无引用 */
  replyingTo: { id: string; role: string; text: string } | null
  setReplyingTo: (msg: { id: string; role: string; text: string } | null) => void
  /** ⭐ 收藏的模型 ID 列表(顺序=用户添加顺序).持久化到 localStorage. */
  favoriteModels: string[]
  /** 切换某个模型的收藏状态(add 或 remove) */
  toggleFavoriteModel: (modelId: string) => void
  /** 🕐 最近使用的模型 ID 列表(按时间倒序,头部最新).持久化到 localStorage. */
  recentModels: string[]
  /** 记录一次模型使用:挪到头部,去重,最多保留 MAX_RECENT_MODELS 个. */
  recordModelUsage: (modelId: string) => void
  /** ⭐/🕐 分组的折叠状态(本次会话内),不持久化. */
  modelSpecialSectionsCollapsed: { favorites: boolean; recent: boolean }
  toggleModelSpecialSection: (section: 'favorites' | 'recent') => void
}

const getInitialSearchEngine = (): 'qianfan' | 'tavily' => {
  if (typeof window === 'undefined') return 'qianfan'
  return localStorage.getItem('chat:searchEngine') === 'tavily' ? 'tavily' : 'qianfan'
}

/** 读取侧边栏折叠偏好: 桌面端用户上次的选择 */
const getInitialSidebarOpen = (): boolean => {
  if (typeof window === 'undefined') return true
  const v = localStorage.getItem('chat:sidebarOpen')
  // 缺失值或 'true' 视为展开;'false' 才视为折叠
  return v === null ? true : v === 'true'
}

const storeInitializer: StateCreator<ChatState> = (set) => ({
  sidebarOpen: typeof window !== 'undefined' ? getInitialSidebarOpen() : true,
  hydrated: false,
  setHydrated: (v) => set({ hydrated: v }),
  toggleSidebar: () =>
    set((state) => {
      const next = !state.sidebarOpen
      if (typeof window !== 'undefined') {
        localStorage.setItem('chat:sidebarOpen', String(next))
      }
      return { sidebarOpen: next }
    }),
  setSidebarOpen: (open) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('chat:sidebarOpen', String(open))
    }
    set({ sidebarOpen: open })
  },
  currentConversationId: null,
  setCurrentConversationId: (id) => set({ currentConversationId: id }),
  conversationTitle: null,
  setConversationTitle: (title) => set({ conversationTitle: title }),
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  settingsSection: null,
  setSettingsSection: (section) => set({ settingsSection: section }),
  previewCode: null,
  setPreviewCode: (code) => set({ previewCode: code }),
  isPreviewFullscreen: false,
  setIsPreviewFullscreen: (fullscreen) => set({ isPreviewFullscreen: fullscreen }),
  conversationVersion: 0,
  bumpConversationVersion: () =>
    set((state) => ({ conversationVersion: state.conversationVersion + 1 })),
  conversationStylePreset: 'balanced',
  setConversationStylePreset: (preset) => set({ conversationStylePreset: preset }),
  conversationMaskId: null,
  setConversationMaskId: (maskId) => set({ conversationMaskId: maskId }),
  searchEngine: typeof window !== 'undefined' ? getInitialSearchEngine() : 'qianfan',
  setSearchEngine: (engine) => {
    localStorage.setItem('chat:searchEngine', engine)
    set({ searchEngine: engine })
  },
  drafts: typeof window !== 'undefined' ? loadDrafts() : {},
  setDraft: (convKey, entry) =>
    set((state) => {
      const next: DraftsMap = { ...state.drafts }
      if (entry === null) {
        delete next[convKey]
      } else {
        next[convKey] = entry
      }
      return { drafts: next }
    }),
  reloadDrafts: () => set({ drafts: loadDrafts() }),
  pendingContinuation: null,
  setPendingContinuation: (p) => set({ pendingContinuation: p }),
  lastReadAt: typeof window !== 'undefined' ? loadLastReadAt() : {},
  markConversationRead: (conversationId) => {
    if (!conversationId) return
    const ts = Date.now()
    persistLastReadAt(conversationId, ts)
    set((state) => ({
      lastReadAt: { ...state.lastReadAt, [conversationId]: ts },
    }))
  },
  removeConversationRead: (conversationId) => {
    if (!conversationId) return
    removeLastReadAt(conversationId)
    set((state) => {
      const next = { ...state.lastReadAt }
      delete next[conversationId]
      return { lastReadAt: next }
    })
  },
  focusedMessageId: null,
  setFocusedMessageId: (id) => set({ focusedMessageId: id }),
  replyingTo: null,
  setReplyingTo: (msg) => set({ replyingTo: msg }),
  favoriteModels:
    typeof window !== 'undefined' ? loadStringArray('chat:favoriteModels') : [],
  toggleFavoriteModel: (modelId) =>
    set((state) => {
      const isFav = state.favoriteModels.includes(modelId)
      const next = isFav
        ? state.favoriteModels.filter((id) => id !== modelId)
        : [...state.favoriteModels, modelId]
      if (typeof window !== 'undefined') {
        localStorage.setItem('chat:favoriteModels', JSON.stringify(next))
      }
      return { favoriteModels: next }
    }),
  recentModels:
    typeof window !== 'undefined' ? loadStringArray('chat:recentModels') : [],
  recordModelUsage: (modelId) =>
    set((state) => {
      // 去掉已有,挪到头部
      const filtered = state.recentModels.filter((id) => id !== modelId)
      const next = [modelId, ...filtered].slice(0, MAX_RECENT_MODELS)
      if (typeof window !== 'undefined') {
        localStorage.setItem('chat:recentModels', JSON.stringify(next))
      }
      return { recentModels: next }
    }),
  modelSpecialSectionsCollapsed: { favorites: false, recent: false },
  toggleModelSpecialSection: (section) =>
    set((state) => ({
      modelSpecialSectionsCollapsed: {
        ...state.modelSpecialSectionsCollapsed,
        [section]: !state.modelSpecialSectionsCollapsed[section],
      },
    })),
})

/** 防止 Next.js dev 模式 HMR 重新执行 create() 破坏单例:
 *  在 globalThis 上缓存 store 实例,跨模块重载共享同一个 store.
 *  同时 SSR/CSR 各自持有一份实例,SSR 渲染结束即丢弃,不会泄漏到客户端 hydration. */
/** zustand 4:create<ChatState>(...) 返回的是 hook 形式(useBoundStore),也是 store API */
export type ChatStoreHook = UseBoundStore<StoreApi<ChatState>>

const globalForStore = globalThis as unknown as { __chatStore?: ChatStoreHook }

const created: ChatStoreHook = (globalForStore.__chatStore
  ?? (create<ChatState>(storeInitializer) as ChatStoreHook))

export const useChatStore: ChatStoreHook = created

if (typeof window !== 'undefined' && !globalForStore.__chatStore) {
  globalForStore.__chatStore = created
}
