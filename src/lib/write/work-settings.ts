/**
 * 作品设定注入引擎 —— 画布生成(/api/write/generate)与聊天(/api/chat)两条链路共用。
 *
 * 目标:把作品层设定(人物/世界观/大纲…)按预算注入 system prompt,
 * 解长篇写作跨章"吃书"(人物漂移、能力体系走样、伏笔丢失)。
 *
 * 两条链路策略不同:
 * - 画布 create/continue/insert:全量注入(启用条目按分类优先级拼接,预算截断);
 * - 聊天:命中式 —— 大纲恒注入 + 标题/别名出现在最近消息/正文尾部里的条目,
 *   全都没命中时只给一行条目索引(告诉模型设定存在,不空耗 token)。
 *
 * 本文件无服务端依赖,设定面板可 import 同一份规则做「注入 ≈X 字」统计。
 */

export interface WorkSettingLike {
  id: string
  category: string
  title: string
  aliases: string
  content: string
  enabled: boolean
}

/** 分类白名单:数组顺序即注入优先级,预算不足先截后面的 */
export const WORK_SETTING_CATEGORIES = [
  { key: "outline", label: "大纲" },
  { key: "character", label: "人物" },
  { key: "system", label: "力量体系" },
  { key: "faction", label: "势力" },
  { key: "place", label: "地点" },
  { key: "item", label: "道具" },
  { key: "other", label: "其他" },
] as const

export type WorkSettingCategory = (typeof WORK_SETTING_CATEGORIES)[number]["key"]

export function isWorkSettingCategory(v: unknown): v is WorkSettingCategory {
  return typeof v === "string" && WORK_SETTING_CATEGORIES.some((c) => c.key === v)
}

export function categoryLabel(key: string): string {
  return WORK_SETTING_CATEGORIES.find((c) => c.key === key)?.label ?? "其他"
}

/** 注入总预算(字符):超出按分类优先级截断。3000 中文字约 2-3k token,写作场景量级可控 */
export const WORK_SETTINGS_BUDGET = 3000

/** 单条正文上限(服务端校验与面板输入共用) */
export const MAX_SETTING_CONTENT_CHARS = 5000

/** 别名拆分:兼容中英文逗号、顿号、分号,去重去空 */
export function splitAliases(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,，、;；]/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  )
}

/** 候选条目:启用且正文非空,按分类优先级排序(同级保持传入顺序,查询侧已按 sort 排过) */
function injectable(settings: WorkSettingLike[]): WorkSettingLike[] {
  const idx = (c: string) => {
    const i = WORK_SETTING_CATEGORIES.findIndex((x) => x.key === c)
    return i < 0 ? WORK_SETTING_CATEGORIES.length : i
  }
  return settings
    .filter((s) => s.enabled && s.content.trim())
    .slice()
    .sort((a, b) => idx(a.category) - idx(b.category))
}

export interface SettingsBlock {
  /** 注入文本(空串=无候选,调用方直接跳过注入) */
  text: string
  /** 注入文本字符数 */
  chars: number
  /** 实际注入条目数 */
  included: number
  /** 候选条目总数 */
  total: number
}

function renderEntry(s: WorkSettingLike): string {
  const aliases = splitAliases(s.aliases)
  const aliasPart = aliases.length ? `（别名：${aliases.join("、")}）` : ""
  return `- 【${categoryLabel(s.category)}】${s.title}${aliasPart}：${s.content.trim()}`
}

const CONSISTENCY_NOTE =
  "写作时必须保持一致：人物称呼、能力体系、关系与既定情节不得漂移；与用户本轮要求冲突时以用户要求为准"

function blockHeader(workTitle: string, description: string): string {
  const head = `## 作品《${workTitle}》设定（${CONSISTENCY_NOTE}）`
  const desc = description.trim()
  return desc ? `${head}\n简介：${desc}` : head
}

/** 预算内拼装:某条超预算时截断其正文,后续条目放弃(优先级在前的先保住)。
 *  total 是候选条目总数(调用方传入),用于日志「注入 N/M 条」的可读性 */
function assemble(head: string, entries: WorkSettingLike[], budget: number, total = entries.length): SettingsBlock {
  const parts: string[] = [head]
  let used = head.length
  let included = 0
  for (const s of entries) {
    const rendered = renderEntry(s)
    const remaining = budget - used - 1
    if (remaining <= 24) break
    if (rendered.length <= remaining) {
      parts.push(rendered)
      used += rendered.length + 1
      included++
    } else {
      parts.push(rendered.slice(0, Math.max(0, remaining - 1)) + "…")
      included++
      break
    }
  }
  const text = included > 0 ? parts.join("\n") : ""
  return { text, chars: text.length, included, total }
}

/** 画布链路:全量注入 */
export function buildFullSettingsBlock(
  work: { title: string; description?: string },
  settings: WorkSettingLike[],
  budget: number = WORK_SETTINGS_BUDGET
): SettingsBlock {
  const entries = injectable(settings)
  if (entries.length === 0) return { text: "", chars: 0, included: 0, total: 0 }
  return assemble(blockHeader(work.title, work.description ?? ""), entries, budget)
}

/** 条目命中:标题或别名(≥2 字,规避单字噪声)出现在 matchText 里 */
function hitsEntry(s: WorkSettingLike, matchText: string): boolean {
  if (s.title && matchText.includes(s.title)) return true
  return splitAliases(s.aliases).some((a) => a.length >= 2 && matchText.includes(a))
}

/** 聊天链路:命中式注入(大纲恒注入 + 命中条目);零命中时给一行条目索引 */
export function buildMatchedSettingsBlock(
  work: { title: string; description?: string },
  settings: WorkSettingLike[],
  matchText: string,
  budget: number = WORK_SETTINGS_BUDGET
): SettingsBlock {
  const entries = injectable(settings)
  if (entries.length === 0) return { text: "", chars: 0, included: 0, total: 0 }

  const selected = entries.filter((s) => s.category === "outline" || hitsEntry(s, matchText))
  const head = blockHeader(work.title, work.description ?? "")
  if (selected.length === 0) {
    const titles = entries
      .slice(0, 10)
      .map((s) => `【${categoryLabel(s.category)}】${s.title}`)
      .join("、")
    const more = entries.length > 10 ? `等共 ${entries.length} 条` : ""
    const text = `${head}\n（本轮未命中具体条目，未注入内容。作品已有：${titles}${more}。写到相关人物或设定时，以对话中既有描写为准，不要凭空发明新设定）`
    return { text, chars: text.length, included: 0, total: entries.length }
  }
  return assemble(head, selected, budget, entries.length)
}
