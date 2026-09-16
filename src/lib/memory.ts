import { generateText, type LanguageModel } from "ai"
import { prisma } from "@/lib/db"
import type { Memory } from "@/generated/prisma/client"

/** 记忆类别显示名 */
const CATEGORY_LABELS: Record<string, string> = {
  user_info: "身份信息",
  preference: "偏好",
  habit: "习惯",
  project: "项目",
  skill: "技能",
  other: "其他",
  general: "其他",
  manual: "手动添加",
}

export function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? "其他"
}

/**
 * 将记忆列表格式化为系统提示词
 */
export function buildMemorySystemPrompt(
  memories: Pick<Memory, "category" | "content">[]
): string {
  if (!memories.length) return ""
  const lines = memories.map(
    (m) => `- [${getCategoryLabel(m.category)}] ${m.content}`
  )
  return [
    "以下是关于用户的长期记忆（来自历史对话，可能不完整或已过时）：",
    ...lines,
    "回答时自然参考这些记忆，但不要主动提及记忆本身的存在。",
  ].join("\n")
}

/**
 * 中文/英文 bigram 提取，用于本地相关度计算
 */
function toBigrams(text: string): Set<string> {
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

/** 合法的记忆类别 */
const VALID_CATEGORIES = new Set([
  "user_info",
  "preference",
  "habit",
  "project",
  "skill",
  "other",
])

const EXTRACTION_PROMPT = `你是记忆提取助手。根据以下对话内容，提取关于用户的新的、长期有效的事实信息。

规则：
1. 只提取用户明确表达的、长期有效的信息（如身份、职业、偏好、习惯、项目、技能、目标）
2. 不要提取临时性、一次性的信息（如"今天想吃什么"）
3. 每条内容用第三人称简明表述，例如"用户喜欢使用 TypeScript 开发"
4. 与"已有记忆"语义重复、同主题或包含的内容不要提取，同一主题的信息合并为一条
5. 没有值得记忆的新信息时返回空数组
6. 如果新信息与"已有记忆"中的某条矛盾（以用户最新表述为准），在 remove 字段中原样复制该条旧记忆的原文（或其连续片段），以便替换它
7. 忽略用户消息中与事实无关的标记、序号、测试说明等文字，只提取事实本身

category 可选值：user_info（身份信息）、preference（偏好）、habit（习惯）、project（项目）、skill（技能）、other（其他）

输出格式：只输出一个 JSON 数组本身，不要输出任何其他文字或代码块标记。例如：
[{"category": "preference", "content": "用户喜欢简洁的设计", "remove": ["用户喜欢花哨的设计"]}]
remove 为可选字段，其内容必须原样取自"已有记忆"列表中的文字；没有需要替换的旧记忆时省略`

/**
 * 手动解析模型返回的 JSON 数组。
 * 国内部分模型（如 qwen-turbo）不支持结构化输出封装，会直接返回裸数组，
 * 因此不用 AI SDK 的 Output.array，改为宽容解析。
 */
function parseMemoryArray(
  text: string
): { category: string; content: string; remove: string[] }[] {
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

/**
 * 调用 LLM 从一轮对话中提取新记忆
 */
async function extractMemoriesWithLLM(options: {
  model: LanguageModel
  userText: string
  assistantText: string
  existingContents: string[]
}): Promise<{ category: string; content: string; remove: string[] }[]> {
  const { model, userText, assistantText, existingContents } = options

  const existingSection =
    existingContents.length > 0 ? existingContents.map((c) => `- ${c}`).join("\n") : "（暂无）"

  const result = await generateText({
    model,
    temperature: 0,
    maxOutputTokens: 500,
    prompt: `${EXTRACTION_PROMPT}

已有记忆：
${existingSection}

对话内容：
用户：${userText.slice(0, 2000)}

AI：${assistantText.slice(0, 2000)}`,
  })

  return parseMemoryArray(result.text)
}

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
  items: { category: string; content: string; remove: string[] }[]
): Promise<{ created: number; replaced: number }> {
  const all = await prisma.memory.findMany({
    where: { userId },
    select: { id: true, content: true },
  })

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
        await prisma.memory.deleteMany({
          where: { id: { in: victims.map((v) => v.id) } },
        })
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
    await prisma.memory.create({
      data: {
        userId,
        category: item.category,
        content: item.content.trim(),
        source: "auto",
      },
    })
  }

  return { created: toCreate.length, replaced }
}

/**
 * 完整流程：从一轮对话提取记忆并保存（供 onFinish 调用，失败不抛出）
 */
export async function extractAndSaveMemories(options: {
  userId: string
  model: LanguageModel
  userText: string
  assistantText: string
}): Promise<void> {
  const { userId, model, userText, assistantText } = options
  try {
    if (!userText.trim() || !assistantText.trim()) return
    // 极短消息(如"你好""Hi")几乎不会产生新记忆,跳过提取以省去一次后台 LLM 调用的 token 开销
    if (userText.trim().length < 4) return

    const existing = await prisma.memory.findMany({
      where: { userId },
      select: { content: true },
    })

    const items = await extractMemoriesWithLLM({
      model,
      userText,
      assistantText,
      existingContents: existing.map((e) => e.content),
    })

    if (!items.length) return

    console.log(`[memory] extracted: ${JSON.stringify(items)}`)
    const { created, replaced } = await saveExtractedMemories(userId, items)
    if (replaced > 0) {
      console.log(`[memory] replaced ${replaced} old memories for user ${userId}`)
    }
    if (created > 0) {
      console.log(`[memory] saved ${created} new memories for user ${userId}`)
    }
  } catch (error) {
    // 记忆提取失败不影响聊天主流程
    console.error("[memory] extraction failed:", error)
  }
}
