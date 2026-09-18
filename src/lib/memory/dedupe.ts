import { toBigrams } from "./relevance"
import { listAllMemoryFacts, createAutoMemory, deleteMemoriesByIds } from "./store"
import type { ExtractedMemoryItem } from "./parser"

/**
 * 宽容匹配 remove 片段与已有记忆：
 * 先做标点/空白归一化后的包含判断，再退化为 bigram 重叠率 ≥ 60%
 */
function fragmentMatches(fragment: string, content: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[\s，。！？、,.!?：:；;""''（）()\-—~]/g, "")
  const f = norm(fragment)
  const c = norm(content)
  if (!f || !c) return false
  if (c.includes(f)) return true
  if (f.length < 4) return false
  const a = toBigrams(f)
  const b = toBigrams(c)
  if (!a.size) return false
  let overlap = 0
  a.forEach((g) => {
    if (b.has(g)) overlap++
  })
  return overlap / a.size >= 0.6
}

/**
 * 保存提取出的记忆：
 * - 替换：新信息与旧记忆矛盾时（remove 字段），先删除被取代的旧记忆
 * - 去重：与剩余记忆互为包含关系则跳过
 */
export async function saveExtractedMemories(
  userId: string,
  items: ExtractedMemoryItem[]
): Promise<{ created: number; replaced: number }> {
  const all = await listAllMemoryFacts(userId)

  // 1) 先处理矛盾替换：删除被新记忆取代的旧记忆（以最新表述为准）
  let replaced = 0
  const deletedIds = new Set<string>()
  for (const item of items) {
    for (const fragment of item.remove) {
      const trimmed = fragment.trim()
      if (!trimmed || trimmed.length < 2) continue
      const victims = all.filter(
        (v) => !deletedIds.has(v.id) && fragmentMatches(trimmed, v.content)
      )
      if (victims.length > 0) {
        await deleteMemoriesByIds(victims.map((v) => v.id))
        victims.forEach((v) => deletedIds.add(v.id))
        replaced += victims.length
      }
    }
  }

  // 2) 再对剩余记忆去重
  const remaining = all.filter((v) => !deletedIds.has(v.id))
  const toCreate = items.filter((item) => {
    const c = item.content.trim()
    if (c.length < 4 || c.length > 200) return false
    return !remaining.some(
      (e) => e.content.includes(c) || c.includes(e.content)
    )
  })

  for (const item of toCreate) {
    await createAutoMemory(userId, item.category, item.content.trim())
  }

  return { created: toCreate.length, replaced }
}
