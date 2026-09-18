/**
 * 记忆导入解析器
 *
 * 设计目标：兼容多种文本格式，让用户从 ChatGPT / Claude / Grok 等导出记忆后
 * 直接粘贴即可解析成结构化的 Memory 条目，再经 UI 二次确认后写入数据库。
 *
 * 支持的格式（按优先级尝试）：
 *  1. 类别前缀：[身份信息] 用户名字是张三
 *  2. 类别标题段： "1. 人口统计信息：" 下面的 * / - / 1) 项目属于该类别
 *  3. 简单行格式：每行一条（默认归类为 "other"）
 *
 * 排除：
 *  - 「证据：…」「Evidence: …」「日期：…」等元数据行
 *  - 「导入来源：…」结尾行
 *  - 「类别（按此顺序输出）：」类提示行
 */

import type { Memory } from "@/generated/prisma/client"

/** 解析后得到的单条记忆草稿（用户确认后再入库） */
export interface ParsedMemoryDraft {
  /** 内部 category id */
  category: string
  /** 记忆正文（≤ 200 字） */
  content: string
  /** 解析时命中的来源行（用于 UI 提示，便于调试） */
  raw: string
}

const VALID_CATEGORIES = new Set([
  "user_info",
  "preference",
  "habit",
  "project",
  "skill",
  "other",
])

/** 外部类别名（中英文、缩写）→ 内部 category id 映射 */
const CATEGORY_KEYWORDS: Array<{ keywords: string[]; category: string }> = [
  // 身份 / 人口统计
  { keywords: ["身份信息", "人口统计", "用户信息", "基本信息", "demographics"], category: "user_info" },
  { keywords: ["user_info", "identity", "profile"], category: "user_info" },
  // 偏好
  { keywords: ["兴趣和偏好", "兴趣", "偏好", "喜好", "爱好", "preference", "interest"], category: "preference" },
  // 习惯
  { keywords: ["习惯", "habit", "habits"], category: "habit" },
  // 项目 / 事件 / 计划
  { keywords: ["事件、项目和计划", "项目和计划", "项目", "事件", "计划", "project", "plan"], category: "project" },
  // 技能
  { keywords: ["技能", "能力", "skill", "skills"], category: "skill" },
  // 关系
  { keywords: ["关系", "家人", "朋友", "relationship", "relationships"], category: "other" },
  // 指令 / 规则
  { keywords: ["指令", "规则", "要求", "instruction", "rules"], category: "preference" },
  // 兜底
  { keywords: ["其他", "other"], category: "other" },
]

/** 把外部类别名解析为内部 category id，未命中返回 null */
export function detectCategory(label: string): string | null {
  const lower = label.toLowerCase().trim()
  if (!lower) return null
  for (const { keywords, category } of CATEGORY_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k.toLowerCase()))) {
      return category
    }
  }
  return null
}

/** 是否元数据/噪音行（不应作为记忆正文） */
function isNoiseLine(line: string): boolean {
  // 先去掉常见项目前缀（* / - / + / 编号），再判断
  const t = line
    .trim()
    .replace(/^\s*[-*+•]\s+/, "")
    .replace(/^\s*\d+[.)、]\s+/, "")
    .trim()
  if (!t) return true
  // 证据 / 日期 / Evidence / Date
  if (/^(证据|evidence|日期|date)\s*[：:]/i.test(t)) return true
  // 「导入来源：ChatGPT」类结束行
  if (/^导入来源\s*[：:]/i.test(t)) return true
  // 「类别（按此顺序输出）：」类提示行
  if (/^类别.*[：:]\s*$/.test(t)) return true
  return false
}

/**
 * 是否「无可用信息」类的占位符文本（应直接划掉删除）。
 * 典型例子：
 *   - "暂无可用的人口统计信息。"
 *   - "暂无可用信息。"
 *   - "暂无存储的明确规则。"
 *   - "未提供。"
 * 规则：剥去尾部句末标点后 ≤ 30 字，且匹配已知占位符开头。
 */
function isPlaceholderText(text: string): boolean {
  if (!text) return true
  const t = text.trim().replace(/[。.！!？?，,；;：:]+$/, "").trim()
  if (!t) return true
  if (t.length > 30) return false // 太长 → 视为真实内容，不当作占位符
  if (/^暂无/.test(t)) return true
  if (/^未提供/.test(t)) return true
  if (/^未提取/.test(t)) return true
  if (/^未包含/.test(t)) return true
  if (/^未找到/.test(t)) return true
  if (/^未发现/.test(t)) return true
  if (/^未提及/.test(t)) return true
  if (/^未识别/.test(t)) return true
  if (/^无相关/.test(t)) return true
  if (/^无明确/.test(t)) return true
  if (/^无任何/.test(t)) return true
  if (/^没有/.test(t)) return true
  if (/^不适用/.test(t)) return true
  if (/^空[。.！!]?$/.test(t)) return true
  if (/^n\/?a\.?$/i.test(t)) return true
  return false
}

/** 把一行内容去前缀（*, -, +, 1., 1) 等）并去除包裹引号 */
function stripItemPrefix(line: string): string {
  return line
    .replace(/^\s*[-*+•]\s+/, "")
    .replace(/^\s*\d+[.)、]\s+/, "")
    .replace(/^["「”]*(.+?)["」”]*$/, "$1")
    .trim()
}

/**
 * 解析整段文本为记忆草稿列表。
 * - 不抛异常，任何格式下都不会报错
 * - 自动去重（同一条正文只出现一次）
 * - 自动跳过证据行 / 导入来源行 / 空行
 */
export function parseMemoryText(text: string): ParsedMemoryDraft[] {
  if (!text || !text.trim()) return []

  const lines = text.split(/\r?\n/)
  const drafts: ParsedMemoryDraft[] = []
  const seen = new Set<string>() // 正文去重

  // 状态机：当前正在解析的类别（遇到类别标题时更新）
  let currentCategory: string | null = null

  // 累计未确定类别的「悬挂条目」：如果到末尾还没遇到类别，归为 other
  const unclassified: ParsedMemoryDraft[] = []

  /**
   * 判断一行是否是「类别标题」。
   * 真实场景里 ChatGPT / Claude / Gemini 输出形如：
   *   "1. 人口统计信息：常用名字、职业、教育程度和常住地。"
   *   "2. 兴趣和偏好：持续积极的投入..."
   *   "1. 人口统计信息："        ← 单纯标题（带冒号）
   *   "人口统计信息"             ← 单纯标题（无冒号，如 Gemini 输出格式）
   * 共同特征：以编号开头或独立成行，能识别成已知类别。
   */
  const tryParseHeader = (line: string): { category: string } | null => {
    const t = line.trim()
    if (!t) return null
    // 占位符文本一定不是标题（如 "暂无可用的人口统计信息。"）
    if (isPlaceholderText(t)) return null

    // 1) 严格匹配：<编号>. <类别名>：... 或 <编号>）<类别名>：...
    const numbered = t.match(/^\d+[.)、]\s*([^：:]{1,30})\s*[：:]\s*(.*)$/)
    if (numbered) {
      const label = numbered[1].replace(/^[【\[]+|[】\]]+$/g, "").trim()
      const cat = detectCategory(label)
      if (cat) return { category: cat }
      // 即便没识别出类别，描述太长也可能是长描述句（> 30 字），不当标题处理
      if (numbered[2].length > 30) return null
    }
    // 2) 单纯标题（带冒号、无描述）：<类别名>：
    const plainHeader = t.match(/^([^：:\[\]]{1,20})\s*[：:]\s*$/)
    if (plainHeader) {
      const label = plainHeader[1].replace(/^\d+[.)、]\s*/, "").trim()
      const cat = detectCategory(label)
      if (cat) return { category: cat }
    }
    // 3) 标题 + 简短描述：<类别名>：<描述（≤ 50 字）>
    //    例如 "人口统计信息：常用名字、职业、教育程度和常住地。"
    //    label 必须只含中文字符与少量顿/逗/分号（2~12 字），避免误伤普通内容
    const withDesc = t.match(/^([一-龥、，；\s]{2,12})\s*[：:]\s*(.{1,50})$/)
    if (withDesc) {
      const label = withDesc[1].trim()
      const cat = detectCategory(label)
      if (cat) return { category: cat }
    }
    // 4) 纯标题（无冒号）：Gemini 等常输出这种格式
    //    例 "人口统计信息"、"兴趣和偏好"、"关系"、"指令"、"标注日期的事件、项目和计划"
    //    条件：长度 ≤ 16、仅中文与少量标点、且能识别为已知类别
    if (t.length <= 16 && /^[一-龥、，；\s]+$/.test(t)) {
      const cat = detectCategory(t)
      if (cat) return { category: cat }
    }
    return null
  }

  const push = (raw: string, content: string, category: string | null) => {
    const trimmed = content.trim()
    if (trimmed.length < 4) return // 太短（基本是噪音）
    if (trimmed.length > 200) return // 超过单条上限，过滤掉（用户可在 UI 里手动截断）
    if (isPlaceholderText(trimmed)) return // "暂无…"类占位符，直接划掉
    const key = trimmed.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    const draft: ParsedMemoryDraft = {
      category: category && VALID_CATEGORIES.has(category) ? category : "other",
      content: trimmed,
      raw,
    }
    if (category) drafts.push(draft)
    else unclassified.push(draft)
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      // 空行：段落分隔，可能意味着「该段条目结束」但下一段可能换类别
      // 这里不做特殊处理，类别状态由后续标题行决定
      continue
    }
    if (isNoiseLine(line)) continue

    // 1) 检测 `[xxx]` 标签前缀：[身份信息] 用户名字是张三
    const bracketMatch = trimmed.match(/^\[([^\]]+)\]\s*(.+)$/)
    if (bracketMatch) {
      const label = bracketMatch[1]
      const content = stripItemPrefix(bracketMatch[2])
      const cat = detectCategory(label)
      push(trimmed, content, cat)
      continue
    }

    // 2) 检测类别标题：「1. 人口统计信息：…」或「人口统计信息：…」
    //    标题必须能识别为已知类别，否则就是普通描述行
    const header = tryParseHeader(trimmed)
    if (header) {
      currentCategory = header.category
      continue
    }

    // 3) 常规条目行：去前缀后作为一条记忆
    const content = stripItemPrefix(trimmed)
    if (!content) continue
    push(trimmed, content, currentCategory)
  }

  // 把未分类条目追加到末尾（归为 other）
  drafts.push(...unclassified)
  return drafts
}

/**
 * 把 Memory 草稿按 category 分组，便于 UI 预览
 */
export function groupDraftsByCategory(
  drafts: ParsedMemoryDraft[]
): Record<string, ParsedMemoryDraft[]> {
  const grouped: Record<string, ParsedMemoryDraft[]> = {}
  for (const d of drafts) {
    if (!grouped[d.category]) grouped[d.category] = []
    grouped[d.category].push(d)
  }
  return grouped
}

/** UI 上显示的导入来源常见候选 */
export const COMMON_IMPORT_SOURCES = [
  "ChatGPT",
  "Claude",
  "Grok",
  "Gemini",
  "文心一言",
  "通义千问",
  "Kimi",
  "DeepSeek",
  "豆包",
  "其他",
] as const

/** 导入面板中显示的参考提示文本（供用户复制粘贴到其他 AI 获取导出格式） */
export const MEMORY_IMPORT_REFERENCE = `帮我把一个 AI 助理中的上下文导入到另一个 AI 助理。你的任务是回顾我们过往的对话，总结你对我的了解。

在输出中，请避免使用第一人称代词（我、我的）和第二人称代词（你、你的）。请改用"用户"或使用中性词语来指代你从过往对话了解到的人。

尽可能保留用户的原话，尤其是指令和偏好方面的内容。

类别（按此顺序输出）：
1. 人口统计信息：常用名字、职业、教育程度和常住地。
2. 兴趣和偏好：持续积极的投入（不只是拥有某个物品或单次购买）。
3. 关系：已确认的长期关系。
4. 标注日期的事件、项目和计划：近期重要活动的记录。
5. 指令：我明确要求你今后遵循的规则，包括"必须做到的事项""绝对禁止的事项"以及行为纠正。仅包含存储的记忆中的规则，不包含对话中的规则。

格式：
将内容按照上述类别分段，并标出对应类别。尽量引用我在提示中输入过的原话，以此作为每个条目的证据。按照以下格式构建每个条目：
* 用户的名字是<name>。
    * 证据：用户说"叫我<name>"。日期：[YYYY-MM-DD]。

输出：
- 仅输出要求提供的信息。不得包含任何对话填充语、介绍性文字或结束语。

最后补全句子"导入来源：<name>"，其中 name 应替换为 ChatGPT、Claude、Grok 等。回答必须以这句话结束。`

/** Memory 数据 → ParsedMemoryDraft（用于「再次导入」场景复用 UI） */
export function memoryToDraft(m: Pick<Memory, "category" | "content">): ParsedMemoryDraft {
  return {
    category: m.category,
    content: m.content,
    raw: m.content,
  }
}
