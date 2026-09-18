/**
 * LLM 提取结果解析：把模型返回的文本宽容地解析为结构化记忆条目。
 * 国内部分模型（如 qwen-turbo）不支持结构化输出封装，会直接返回裸数组，
 * 因此不用 AI SDK 的 Output.array，改为手动解析。
 */

/** 合法的记忆类别 */
export const VALID_CATEGORIES = new Set([
  "user_info",
  "preference",
  "habit",
  "project",
  "skill",
  "other",
])

/** 单条提取结果（remove 为需要替换掉的旧记忆原文片段） */
export interface ExtractedMemoryItem {
  category: string
  content: string
  remove: string[]
}

export function parseMemoryArray(text: string): ExtractedMemoryItem[] {
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")
    const start = cleaned.indexOf("[")
    const end = cleaned.lastIndexOf("]")
    if (start === -1 || end === -1 || end <= start) return []
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1))
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null)
      .map((it) => ({
        category:
          typeof it.category === "string" && VALID_CATEGORIES.has(it.category)
            ? it.category
            : "other",
        content: typeof it.content === "string" ? it.content.trim() : "",
        remove: Array.isArray(it.remove)
          ? it.remove.filter((r): r is string => typeof r === "string")
          : [],
      }))
      .filter((it) => it.content.length > 0 && it.content.length <= 200)
  } catch {
    return []
  }
}
