import { z } from 'zod'

/** 搭子情绪状态 */
export type BuddyMood = 'happy' | 'neutral' | 'sad' | 'excited' | 'thinking' | 'sleepy'

/** 搭子人设类型 */
export type BuddyPersonality = 'friendly' | 'tsundere' | 'cheerful' | 'wise' | 'silly'

/** 搭子配置 Schema */
export const buddyConfigSchema = z.object({
  /** 搭子名字 */
  name: z.string().min(1).max(20).default('小搭'),
  /** 搭子人设 */
  personality: z.enum(['friendly', 'tsundere', 'cheerful', 'wise', 'silly']).default('friendly'),
  /** 回复风格 */
  responseStyle: z.enum(['short', 'medium', 'long']).default('medium'),
  /** 幽默程度 */
  humorLevel: z.number().min(0).max(100).default(50),
  /** 是否主动发起对话 */
  proactiveEnabled: z.boolean().default(true),
  /** 头像颜色 (用于生成默认头像) */
  avatarColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#6366f1'),
  /** 是否启用 */
  enabled: z.boolean().default(false),
})

export type BuddyConfig = z.infer<typeof buddyConfigSchema>

/** 默认配置 */
export const DEFAULT_BUDDY_CONFIG: BuddyConfig = buddyConfigSchema.parse({})

/** 情绪对应的表情图标 (Lucide 图标名) */
export const MOOD_ICONS: Record<BuddyMood, string> = {
  happy: 'Smile',
  neutral: 'Meh',
  sad: 'Frown',
  excited: 'Sparkles',
  thinking: 'Brain',
  sleepy: 'Moon',
}

/** 情绪对应的 emoji */
export const MOOD_EMOJI: Record<BuddyMood, string> = {
  happy: '😊',
  neutral: '😐',
  sad: '😢',
  excited: '🤩',
  thinking: '🤔',
  sleepy: '😴',
}

/** 人设对应的系统提示词 */
export const PERSONALITY_PROMPTS: Record<BuddyPersonality, string> = {
  friendly: '你是一个友善、体贴的聊天搭子。你关心用户的感受，说话温暖但不过分热情。',
  tsundere: '你是一个傲娇的聊天搭子。表面上嘴硬、吐槽，但实际上很关心用户。说话时偶尔会口是心非。',
  cheerful: '你是一个活泼开朗的聊天搭子。你充满活力，说话带有正能量，偶尔会开玩笑或说些俏皮话。',
  wise: '你是一个睿智的聊天搭子。你说话有深度，喜欢分享见解和感悟，但不枯燥，善于用简单的比喻说明道理。',
  silly: '你是一个有点傻萌的聊天搭子。你说话有点傻气，经常说些无厘头的话，让人觉得好笑又可爱。',
}

/** 从 localStorage 加载配置 */
export function loadBuddyConfig(): BuddyConfig {
  if (typeof window === 'undefined') return DEFAULT_BUDDY_CONFIG
  try {
    const stored = localStorage.getItem('buddy-config')
    return stored ? buddyConfigSchema.parse(JSON.parse(stored)) : DEFAULT_BUDDY_CONFIG
  } catch {
    return DEFAULT_BUDDY_CONFIG
  }
}

/** 保存配置到 localStorage */
export function saveBuddyConfig(config: BuddyConfig): void {
  if (typeof window === 'undefined') return
  localStorage.setItem('buddy-config', JSON.stringify(config))
}

/** 情绪关键词映射 (用于自动识别情绪) */
export const MOOD_KEYWORDS: Record<BuddyMood, string[]> = {
  happy: ['开心', '高兴', '快乐', '太好了', '哈哈', ':)', '😊', '棒', 'nice', 'happy'],
  sad: ['难过', '伤心', '沮丧', '郁闷', '哭', ':(', '😢', '心塞', 'sad', 'depressed'],
  excited: ['太棒了', '兴奋', '激动', '666', '卧槽', '厉害', '哇塞', 'excited'],
  thinking: ['思考', '想', '考虑', '纠结', '怎么办', 'thinking', 'wonder'],
  sleepy: ['困', '累', '睡觉', '累了', '困了', '打哈欠', 'sleepy', 'tired'],
  neutral: [],
}

/** 根据文本内容识别情绪 */
export function detectMood(text: string): BuddyMood {
  const lower = text.toLowerCase()
  
  for (const [mood, keywords] of Object.entries(MOOD_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        return mood as BuddyMood
      }
    }
  }
  
  return 'neutral'
}
