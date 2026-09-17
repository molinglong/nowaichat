import { useChatStore } from '@/store/chat-store'
import { toast } from '@/lib/toast'
import {
  getSettingDef,
  isAllowedValue,
  formatSettingValue,
  type SettingKey,
} from '@/lib/settings/registry'

/**
 * AI 设置控制 —— 前端执行器（仅客户端使用，勿在服务端 import：
 * 依赖 localStorage / zustand / window.matchMedia）
 *
 * 职责：
 * - buildSettingsSnapshot(): 请求前组装客户端设置快照，随 body 上报
 *   （DB 项由 chat route 直查 User 表，不经此上报，见 settings-tool.ts）
 * - executeSettingsOps(): 监听到 update_settings tool part 后按注册表分发执行。
 *   未知 key（含总开关 aiSettingsControl——注册表内无 apply 分支）一律拒绝，
 *   构成 AI 无法触碰元开关的第三道防线。
 */

/** 客户端设置快照：只含注册表中有"当前值"的项（open_settings 是动作型，不进快照） */
export function buildSettingsSnapshot(): Partial<Record<SettingKey, string>> {
  if (typeof window === 'undefined') return {}
  const s = useChatStore.getState()
  return {
    theme: localStorage.getItem('theme') ?? 'system',
    sidebar: s.sidebarOpen ? 'open' : 'close',
    search_engine: s.searchEngine,
    style_preset: s.conversationStylePreset,
    mask: s.conversationMaskId ?? 'off',
  }
}

export interface SettingsOpResult {
  key: string
  value: string
  ok: boolean
  /** 失败原因（unknown_key / invalid_value / 执行异常），成功时 undefined */
  reason?: string
}

/** 单条 op 的执行器：与 SettingsModal 手动操作的写法保持一致 */
const APPLY: Partial<Record<SettingKey, (value: string) => void | Promise<void>>> = {
  // 照抄 SettingsModal.handleThemeChange:system 移除显式选择跟随系统,其余写 localStorage+DOM
  theme: (value) => {
    if (value === 'system') {
      localStorage.removeItem('theme')
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.classList.toggle('dark', dark)
    } else {
      localStorage.setItem('theme', value)
      document.documentElement.classList.toggle('dark', value === 'dark')
    }
  },
  sidebar: (value) => {
    useChatStore.getState().setSidebarOpen(value === 'open')
  },
  search_engine: (value) => {
    if (value === 'qianfan' || value === 'tavily') {
      useChatStore.getState().setSearchEngine(value)
    }
  },
  style_preset: (value) => {
    useChatStore.getState().setConversationStylePreset(value)
    // 与 SettingsModal 手动切换同款:store 即时生效,会话归属的持久化仍以界面操作为准
    localStorage.setItem('chat:stylePreset', value)
  },
  mask: (value) => {
    useChatStore.getState().setConversationMaskId(value === 'off' ? null : value)
  },
  open_settings: (value) => {
    const s = useChatStore.getState()
    s.setSettingsSection(value)
    s.setSettingsOpen(true)
  },
  // ── P2: DB 存储项,复用现有的手动开关/设置面板写入路径(PATCH 端点自带鉴权与校验)
  clarify: async (value) => {
    const res = await fetch('/api/settings/clarify', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: value === 'on' }),
    })
    if (!res.ok) throw new Error(`PATCH /api/settings/clarify ${res.status}`)
  },
  memory: async (value) => {
    const res = await fetch('/api/memories/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: value === 'on' }),
    })
    if (!res.ok) throw new Error(`PATCH /api/memories/settings ${res.status}`)
  },
  image_model: async (value) => {
    // 端点内校验内置模型 ID(与 registry 同源 image-models.config)
    const res = await fetch('/api/image-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { imageModel: value } }),
    })
    if (!res.ok) throw new Error(`PATCH /api/image-settings ${res.status}`)
  },
  image_size: async (value) => {
    const res = await fetch('/api/image-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { imageSize: value } }),
    })
    if (!res.ok) throw new Error(`PATCH /api/image-settings ${res.status}`)
  },
}

/**
 * 执行一轮 update_settings 的全部操作。
 * 幂等（同值重复设置无害）+ toolCallId 由调用方去重，多泳道重复调用安全。
 * 返回逐条结果并统一 toast。
 */
export async function executeSettingsOps(
  input: unknown
): Promise<SettingsOpResult[]> {
  const ops = (input as { operations?: unknown } | null | undefined)?.operations
  if (!Array.isArray(ops)) return []

  const results: SettingsOpResult[] = []
  for (const op of ops) {
    const key = (op as { key?: unknown } | null | undefined)?.key
    const value = (op as { value?: unknown } | null | undefined)?.value
    if (typeof key !== 'string' || typeof value !== 'string') {
      results.push({ key: String(key ?? ''), value: String(value ?? ''), ok: false, reason: 'malformed' })
      continue
    }

    // 防线 3:注册表外的 key（含 aiSettingsControl）无 apply 分支,一律拒绝
    const def = getSettingDef(key)
    const applyFn = APPLY[key as SettingKey]
    if (!def || !applyFn) {
      results.push({ key, value, ok: false, reason: 'unknown_key' })
      continue
    }
    if (!isAllowedValue(key, value)) {
      results.push({ key, value, ok: false, reason: 'invalid_value' })
      continue
    }

    try {
      await applyFn(value)
      results.push({ key, value, ok: true })
    } catch (err) {
      console.error('[settings] Failed to apply op:', key, value, err)
      results.push({ key, value, ok: false, reason: 'apply_error' })
    }
  }

  // 统一 toast 反馈:成功合并一条,失败逐条
  const okLabels = results
    .filter((r) => r.ok)
    .map((r) => `${getSettingDef(r.key)?.label ?? r.key} → ${formatSettingValue(r.key, r.value)}`)
  if (okLabels.length > 0) {
    toast.success(`已更新设置：${okLabels.join('、')}`)
  }
  for (const r of results.filter((x) => !x.ok)) {
    if (r.reason === 'unknown_key') {
      toast.error(`AI 尝试修改了不受支持的设置项（${r.key}），已忽略`)
    } else if (r.reason === 'invalid_value') {
      toast.error(`设置值无效（${r.key}=${r.value}），已忽略`)
    } else {
      toast.error('设置修改失败，请重试')
    }
  }
  return results
}
