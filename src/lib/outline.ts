// Markdown 大纲工具：从 AI 回复内容里抽取标题层级 + slug。
// - slug 用于生成 DOM id，重复时自动加 -1/-2 后缀。
// - 抽取时机是「已完成的 markdown 字符串」,不依赖 DOM,
//   这样大纲组件能拿到稳定的初始数据,再由 scroll-spy 校正。

export type OutlineItem = {
  /** DOM id,通过 slugify 生成 */
  id: string
  /** 1-3 级标题 */
  level: 1 | 2 | 3
  /** 原始文本(去除前后空白) */
  text: string
}

/**
 * 从 markdown 文本里抽取 h1/h2/h3 标题。
 * - 只识别行首 1-3 个 `#`(4 个以上忽略,避免污染大纲)。
 * - `#` 后必须有空格,避免误判 `#hashtag`。
 * - 跳过代码围栏 ``` 内部的行,以及引用 `>` 后的标题也跳过(避免噪声)。
 */
export function extractHeadings(markdown: string): OutlineItem[] {
  if (!markdown) return []
  const lines = markdown.split(/\r?\n/)
  const items: OutlineItem[] = []
  const idCounts = new Map<string, number>()
  let inFence = false

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()

    // 跟踪代码围栏(``` 或 ~~~),围栏内的 `#` 不算标题
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    // 跳过引用行内的标题(> # xxx):降低噪声
    if (/^\s*>/.test(line)) continue

    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!m) continue

    const level = m[1].length as 1 | 2 | 3
    const text = m[2].trim()
    if (!text) continue

    const baseId = slugify(text)
    const count = idCounts.get(baseId) ?? 0
    idCounts.set(baseId, count + 1)
    const id = count === 0 ? baseId : `${baseId}-${count}`

    items.push({ id, level, text })
  }

  return items
}

/**
 * 把任意文本转成 URL 友好的 slug。
 * - 保留中英文,去掉标点和空格。
 * - 同标题重复时调用方负责加后缀。
 */
export function slugify(text: string): string {
  if (!text) return 'heading'
  // 优先保留中英文/数字,把其他字符压成连字符
  const ascii = text
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '-') // 各种空白 -> -
    .replace(/[`*_~()[\]{}<>!#/\\,.?:;'"`|]/g, '') // 标点
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (ascii) return ascii
  // 纯中文/特殊符号时,用「首尾汉字 + 长度」做稳定 hash,保证可重现
  const cleaned = text.replace(/[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, '')
  if (!cleaned) return 'heading'
  let h = 0
  for (let i = 0; i < cleaned.length; i++) {
    h = (h * 31 + cleaned.charCodeAt(i)) >>> 0
  }
  return `h-${cleaned.slice(0, 8)}-${h.toString(36)}`
}
