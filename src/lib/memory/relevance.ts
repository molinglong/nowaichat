import type { Memory } from "@/generated/prisma/client"

/**
 * 中文/英文 bigram 提取，用于本地相关度计算
 * （dedupe 的片段宽容匹配也复用此函数）
 */
export function toBigrams(text: string): Set<string> {
  const cleaned = text.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, "")
  const set = new Set<string>()
  for (let i = 0; i < cleaned.length - 1; i++) {
    set.add(cleaned.slice(i, i + 2))
  }
  return set
}

/**
 * 选择注入系统提示词的记忆（控制每次请求的固定 token 开销）：
 * - 身份信息(user_info)与手动添加的记忆始终注入
 * - 其余记忆仅在内容与当前消息有实际相关度(bigram 命中)时注入
 * - 没有命中时用最近更新的少量记忆兜底,避免宽泛消息完全失去上下文
 */
export function getRelevantMemories(
  memories: Memory[],
  userText: string,
  limit = 10
): Memory[] {
  if (memories.length === 0) return []

  const isAlways = (m: Memory) => m.source === "manual" || m.category === "user_info"
  const always = memories.filter(isAlways)
  const rest = memories.filter((m) => !isAlways(m))

  // 与当前消息的实际相关度：bigram 命中率
  // （不再加新鲜度加分，否则闲聊如"你好"也会注入全部记忆）
  const queryBigrams = toBigrams(userText || "")
  const overlapRatio = (content: string): number => {
    if (!queryBigrams.size) return 0
    const a = toBigrams(content)
    if (!a.size) return 0
    let overlap = 0
    queryBigrams.forEach((g) => {
      if (a.has(g)) overlap++
    })
    return overlap / queryBigrams.size
  }

  const quota = Math.max(0, limit - always.length)
  const matched = rest
    .map((m) => ({ m, r: overlapRatio(m.content) }))
    .filter((x) => x.r > 0)
    .sort((a, b) => b.r - a.r || b.m.updatedAt.getTime() - a.m.updatedAt.getTime())
    .slice(0, quota)
    .map((x) => x.m)

  // 兜底：没有命中时保留最近更新的 3 条
  const fill = quota - matched.length
  const recent =
    fill > 0
      ? rest
          .filter((m) => !matched.includes(m))
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .slice(0, Math.min(3, fill))
      : []

  return [...always, ...matched, ...recent]
}
