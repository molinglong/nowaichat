import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand'
import {
  type BuddyConfig,
  type BuddyMood,
  loadBuddyConfig,
  saveBuddyConfig,
  detectMood,
  DEFAULT_BUDDY_CONFIG,
} from '@/lib/buddy-config'

/** 搭子记忆条目 */
export interface BuddyMemoryEntry {
  id: string
  content: string
  importance: number // 0-1
  tags: string[]
  createdAt: number
}

/** 搭子状态 */
export interface BuddyState {
  /** 是否启用搭子模式 */
  enabled: boolean
  /** 搭子配置 */
  config: BuddyConfig
  /** 当前情绪 */
  mood: BuddyMood
  /** 最后交互时间 */
  lastInteraction: number
  /** 最后用户消息 (用于情绪识别) */
  lastUserMessage: string
  /** 搭子记忆列表 */
  memories: BuddyMemoryEntry[]
  /** 设置面板是否打开 */
  settingsOpen: boolean
  /** 搭子是否在说话中 */
  isSpeaking: boolean
  /** 点击计数 (用于触发特殊动作) */
  clickCount: number
  /** 未读消息数 (搭子主动发起的) */
  unreadCount: number
}

/** 搭子 Actions */
export interface BuddyActions {
  /** 切换搭子模式开关 */
  toggleEnabled: () => void
  /** 设置是否启用 */
  setEnabled: (enabled: boolean) => void
  /** 更新配置 */
  updateConfig: (config: Partial<BuddyConfig>) => void
  /** 设置当前情绪 */
  setMood: (mood: BuddyMood) => void
  /** 根据用户消息自动识别情绪 */
  detectMoodFromMessage: (message: string) => void
  /** 记录一次交互 */
  recordInteraction: () => void
  /** 添加记忆 */
  addMemory: (content: string, importance?: number, tags?: string[]) => void
  /** 删除记忆 */
  removeMemory: (id: string) => void
  /** 获取重要记忆 (用于注入 prompt) */
  getImportantMemories: (limit?: number) => BuddyMemoryEntry[]
  /** 打开/关闭设置面板 */
  toggleSettings: () => void
  /** 设置说话状态 */
  setSpeaking: (speaking: boolean) => void
  /** 记录一次点击 */
  recordClick: () => void
  /** 清空未读 */
  clearUnread: () => void
  /** 添加未读消息 */
  addUnread: () => void
  /** 生成搭子系统提示词 */
  generateSystemPrompt: () => string
}

/** 完整搭子 Store 类型 */
export type BuddyStore = BuddyState & BuddyActions

const getInitialConfig = (): BuddyConfig => {
  if (typeof window === 'undefined') return DEFAULT_BUDDY_CONFIG
  return loadBuddyConfig()
}

const storeInitializer: StateCreator<BuddyStore> = (set, get) => ({
  // 初始状态
  enabled: false,
  config: getInitialConfig(),
  mood: 'neutral',
  lastInteraction: Date.now(),
  lastUserMessage: '',
  memories: [],
  settingsOpen: false,
  isSpeaking: false,
  clickCount: 0,
  unreadCount: 0,

  // Actions
  toggleEnabled: () =>
    set((state) => {
      const next = !state.enabled
      const newConfig = { ...state.config, enabled: next }
      saveBuddyConfig(newConfig)
      return { enabled: next, config: newConfig }
    }),

  setEnabled: (enabled) =>
    set((state) => {
      const newConfig = { ...state.config, enabled }
      saveBuddyConfig(newConfig)
      return { enabled, config: newConfig }
    }),

  updateConfig: (updates) =>
    set((state) => {
      const newConfig = { ...state.config, ...updates }
      saveBuddyConfig(newConfig)
      return { config: newConfig }
    }),

  setMood: (mood) => {
    set({ mood })
    // 同步到 localStorage,让独立的桌面窗口能读取
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('buddy-mood', mood)
      } catch {
        // ignore
      }
    }
  },

  detectMoodFromMessage: (message) => {
    const mood = detectMood(message)
    set({ mood, lastUserMessage: message })
  },

  recordInteraction: () =>
    set({ lastInteraction: Date.now() }),

  addMemory: (content, importance = 0.5, tags = []) =>
    set((state) => ({
      memories: [
        {
          id: `memory_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          content,
          importance,
          tags,
          createdAt: Date.now(),
        },
        ...state.memories,
      ],
    })),

  removeMemory: (id) =>
    set((state) => ({
      memories: state.memories.filter((m) => m.id !== id),
    })),

  getImportantMemories: (limit = 5) => {
    const state = get()
    return state.memories
      .filter((m) => m.importance >= 0.5)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit)
  },

  toggleSettings: () =>
    set((state) => ({ settingsOpen: !state.settingsOpen })),

  setSpeaking: (speaking) => set({ isSpeaking: speaking }),

  recordClick: () =>
    set((state) => ({ clickCount: state.clickCount + 1 })),

  clearUnread: () => set({ unreadCount: 0 }),

  addUnread: () =>
    set((state) => ({ unreadCount: state.unreadCount + 1 })),

  generateSystemPrompt: () => {
    const state = get()
    const { config, memories, mood } = state
    
    const moodDescriptions: Record<BuddyMood, string> = {
      happy: '你现在心情很好',
      neutral: '你心情平静',
      sad: '你有点难过',
      excited: '你很兴奋',
      thinking: '你在思考中',
      sleepy: '你有点困',
    }

    const importantMemories = state.getImportantMemories(3)
    const memoryContext = importantMemories.length > 0
      ? `\n\n关于用户的记忆：\n${importantMemories.map((m) => `- ${m.content}`).join('\n')}`
      : ''

    return `你是 ${config.name}，一个聊天搭子。${memoryContext}

当前状态：${moodDescriptions[mood]}

你的性格特点：${getPersonalityDescription(config.personality)}
回复风格：${config.responseStyle === 'short' ? '简洁明了' : config.responseStyle === 'medium' ? '适度详细' : '详细深入'}
幽默程度：${config.humorLevel > 70 ? '很高，喜欢开玩笑' : config.humorLevel > 30 ? '适中' : '比较正经'}

请用符合你性格的方式回复用户，保持自然、亲切的对话氛围。`.trim()
  },
})

/** 获取人设描述 */
function getPersonalityDescription(personality: BuddyConfig['personality']): string {
  const descriptions: Record<BuddyConfig['personality'], string> = {
    friendly: '友善、体贴、温暖',
    tsundere: '傲娇、嘴硬心软、偶尔吐槽',
    cheerful: '活泼开朗、充满正能量',
    wise: '睿智、有深度',
    silly: '有点傻萌、可爱',
  }
  return descriptions[personality]
}

/** 防止 HMR 重新创建 */
type BuddyStoreHook = UseBoundStore<StoreApi<BuddyStore>>

const globalForStore = globalThis as unknown as { __buddyStore?: BuddyStoreHook }

const created: BuddyStoreHook = (globalForStore.__buddyStore
  ?? (create(storeInitializer) as BuddyStoreHook))

export const useBuddyStore = created

if (typeof window !== 'undefined' && !globalForStore.__buddyStore) {
  globalForStore.__buddyStore = created
}
