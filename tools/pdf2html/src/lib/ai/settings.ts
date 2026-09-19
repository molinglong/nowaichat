/**
 * AI 结构化模式的接口配置。
 * 存 localStorage(本地静态工具,不入库不上传);node/测试环境退回默认值。
 */

export interface AiSettings {
  /** OpenAI 兼容接口地址,一般以 /v1 结尾,如 https://中转站/v1 */
  baseUrl: string
  apiKey: string
  /** 视觉模型名,如 gpt-4o / gemini-2.5-flash / qwen-vl-max */
  model: string
  /** 页面渲染倍率(1 = 72dpi);2 ≈ 144dpi,数学密排页建议 2 以上 */
  imageScale: number
  /** 转换页码范围,如 "20-35";空 = 全部 */
  pageRange: string
}

export const AI_SETTINGS_KEY = 'pdf2html.aiSettings'

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: '',
  apiKey: '',
  model: '',
  imageScale: 2,
  pageRange: '',
}

export function loadAiSettings(): AiSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_AI_SETTINGS }
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_AI_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<AiSettings>
    return { ...DEFAULT_AI_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_AI_SETTINGS }
  }
}

export function saveAiSettings(settings: AiSettings): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings))
}

export function isAiConfigured(settings: AiSettings): boolean {
  return Boolean(settings.baseUrl.trim() && settings.apiKey.trim() && settings.model.trim())
}

/**
 * 解析页码范围 "20-35" / "20" 为 [start, end](含两端),越界收紧到文档内。
 * 非法输入返回 null。
 */
export function parsePageRange(range: string, numPages: number): [number, number] | null {
  const trimmed = range.trim()
  if (!trimmed) return null
  const m = trimmed.match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/)
  if (!m) return null
  let start = Number(m[1])
  let end = m[2] ? Number(m[2]) : start
  if (start > end) [start, end] = [end, start]
  start = Math.max(1, start)
  end = Math.min(numPages, end)
  if (start > end) return null
  return [start, end]
}
