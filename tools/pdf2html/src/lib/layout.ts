/**
 * 布局内核:TextItem 流 → 行 → 块(标题/段落/列表)。
 *
 * 全部纯函数,不依赖 pdfjs 与 DOM,vitest 直接喂合成数据。
 * 启发式总纲:
 * - 行 = 基线 y 相近(±半行高)的 item 聚类
 * - 行内拼接只对拉丁词间的大间隙补空格,CJK 之间绝不插空格
 * - 段落 = 行距超阈 / 首行缩进 / 上行句末标点且提前收笔,三信号任一
 * - 标题 = 字号显著大于正文众数,或加粗短行
 * - 列表 = 项目符号/编号前缀的连续行
 */
import type { Block, TextItem, TextLine } from '../types'

/** CJK(含全角区)判定:命中即视作无空格语言,词间不补空格 */
export function isCjkChar(ch: string): boolean {
  if (!ch) return false
  const code = ch.codePointAt(0)!
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  )
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((p, q) => p - q)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** 两 item 之间是否补一个空格:仅拉丁词界、间隙 ≥0.25em */
function needsSpace(prev: TextItem, next: TextItem, gap: number): boolean {
  if (/\s$/.test(prev.str) || /^\s/.test(next.str)) return false
  const em = Math.min(prev.fontSize, next.fontSize) || 12
  if (gap < em * 0.25) return false
  if (isCjkChar(prev.str[prev.str.length - 1]) || isCjkChar(next.str[0])) return false
  return true
}

/** 行内拼接:按 x 排序,间隙按需补空格 */
function assembleLine(items: TextItem[]): TextLine {
  const ordered = [...items].sort((p, q) => p.x - q.x)
  let text = ''
  let prev: TextItem | null = null
  for (const item of ordered) {
    if (prev && needsSpace(prev, item, item.x - (prev.x + prev.width))) text += ' '
    text += item.str
    prev = item
  }
  const last = ordered[ordered.length - 1]
  return {
    text: text.trim(),
    y: median(ordered.map((i) => i.y)),
    x: ordered[0].x,
    right: last.x + last.width,
    fontSize: median(ordered.map((i) => i.fontSize)),
    bold: ordered.some((i) => /bold|black|heavy/i.test(i.fontName)),
  }
}

/** 基线聚类成行:容差取两 item 字号的一半(至少 1.5pt),输出按阅读序(y 降序) */
export function buildLines(items: TextItem[]): TextLine[] {
  if (items.length === 0) return []
  const sorted = [...items].sort((p, q) => q.y - p.y || p.x - q.x)
  const groups: TextItem[][] = []
  let group: TextItem[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i]
    const anchor = group[0]
    const tol = Math.max(1.5, anchor.fontSize * 0.5, item.fontSize * 0.5)
    if (Math.abs(item.y - anchor.y) <= tol) {
      group.push(item)
    } else {
      groups.push(group)
      group = [item]
    }
  }
  groups.push(group)
  // 行内大间隙拆段:同一基线上的双栏/旁注不应粘成一个长行
  return groups
    .flatMap(splitGroupByGap)
    .map(assembleLine)
    .filter((l) => l.text.length > 0)
}

/** 行内拆段阈值:间隙超过 1.8em(至少 10pt)即视为栏界;普通词距 0.25-1em 不受影响 */
const SPLIT_GAP_EM = 1.8
const SPLIT_GAP_MIN_PT = 10

function splitGroupByGap(group: TextItem[]): TextItem[][] {
  const ordered = [...group].sort((p, q) => p.x - q.x)
  const chunks: TextItem[][] = []
  let chunk: TextItem[] = [ordered[0]]
  for (let i = 1; i < ordered.length; i++) {
    const item = ordered[i]
    const prev = chunk[chunk.length - 1]
    const gap = item.x - (prev.x + prev.width)
    const threshold = Math.max(SPLIT_GAP_MIN_PT, SPLIT_GAP_EM * Math.min(prev.fontSize, item.fontSize))
    if (gap > threshold) {
      chunks.push(chunk)
      chunk = [item]
    } else {
      chunk.push(item)
    }
  }
  chunks.push(chunk)
  return chunks
}

/** 段内拼行:CJK 邻接直接相连,拉丁词界补空格 */
export function joinWrapped(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  if (isCjkChar(a[a.length - 1]) || isCjkChar(b[0])) return a + b
  return a + ' ' + b
}

// ---------- 列表前缀 ----------

const UNORDERED_RE = /^[•·▪◦‣●○◆※✦*]\s*/
const DASH_RE = /^[-–—]\s+/
const ORDERED_RE = /^(?:[（(]\s*)?(?:\d{1,3}|[一二三四五六七八九十]{1,3})\s*(?:[）)]|[．.、])\s*/
const CIRCLED_RE = /^[①-⑳]\s*/

export interface ListMatch {
  ordered: boolean
  content: string
}

/** 识别列表行前缀;无前缀返回 null(content 为剥掉前缀后的正文) */
export function matchListPrefix(text: string): ListMatch | null {
  let m = text.match(UNORDERED_RE)
  if (m && m[0].length < text.length) return { ordered: false, content: text.slice(m[0].length) }
  m = text.match(DASH_RE)
  if (m) return { ordered: false, content: text.slice(m[0].length) }
  m = text.match(ORDERED_RE)
  if (m && m[0].length < text.length) return { ordered: true, content: text.slice(m[0].length) }
  m = text.match(CIRCLED_RE)
  if (m && m[0].length < text.length) return { ordered: true, content: text.slice(m[0].length) }
  return null
}

// ---------- 段落与标题 ----------

/** 句末标点(允许后跟收尾引号/括号) */
const SENTENCE_END_RE = /[。！？；…][”』」）)]*$/

/** 正文基准字号:按文本长度加权的众数(0.5pt 粒度) */
function bodySizeOf(lines: TextLine[]): number {
  const buckets = new Map<number, number>()
  for (const line of lines) {
    const key = Math.round(line.fontSize * 2) / 2
    buckets.set(key, (buckets.get(key) ?? 0) + line.text.length)
  }
  let best = 12
  let weight = -1
  for (const [size, w] of buckets) {
    if (w > weight) {
      best = size
      weight = w
    }
  }
  return best
}

/** 正文基准行距:相邻基线间距的中位数(排除离谱大间距) */
function bodyPitchOf(lines: TextLine[]): number {
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y
    if (gap > 0 && gap <= lines[i].fontSize * 2.5) gaps.push(gap)
  }
  return gaps.length === 0 ? 0 : median(gaps)
}

interface SegContext {
  bodySize: number
  /** 正文基准行距;0 表示无法估计(单行页) */
  pitch: number
  /** 全页最右边界,用于「提前收笔」判断 */
  maxRight: number
}

/** 三信号分段:行距超阈 / 首行缩进 / 上行句末标点且提前收笔 */
function isParagraphBreak(prev: TextLine, cur: TextLine, paraLeft: number, ctx: SegContext): boolean {
  if (ctx.pitch > 0 && prev.y - cur.y > ctx.pitch * 1.45) return true
  if (cur.x - paraLeft >= ctx.bodySize * 1.3) return true
  if (SENTENCE_END_RE.test(prev.text) && prev.right < ctx.maxRight - prev.fontSize * 1.5) return true
  return false
}

/** 标题分级:字号显著大于正文众数,或加粗短行 */
function headingLevelOf(line: TextLine, bodySize: number): 1 | 2 | 3 | null {
  const len = Array.from(line.text).length
  const ratio = line.fontSize / bodySize
  if (ratio >= 1.7 && len <= 60) return 1
  if (ratio >= 1.3 && len <= 60) return 2
  if (line.bold && len <= 25 && ratio >= 0.95) return 3
  if (line.bold && ratio >= 1.12 && len <= 40) return 3
  return null
}

/** 文档标题:首页首行 + 居中 + 短行 + 大字/加粗 */
function isDocTitle(line: TextLine, bodySize: number, pageWidth: number): boolean {
  const len = Array.from(line.text).length
  if (len === 0 || len > 40) return false
  const center = (line.x + line.right) / 2
  if (Math.abs(center - pageWidth / 2) > pageWidth * 0.1) return false
  if (line.right - line.x > pageWidth * 0.75) return false
  return line.fontSize >= bodySize * 1.15 || line.bold
}

/** 页眉页脚纯页码行;分栏重排后页码多散落中段,凡纯页码一律剔除 */
const PAGE_NO_RE = /^(?:\d{1,4}|[-–—]\s*\d{1,4}\s*[-–—]|第\s*\d{1,4}\s*页)$/

export function dropPageFurniture(lines: TextLine[]): TextLine[] {
  return lines.filter((l) => !(PAGE_NO_RE.test(l.text) && Array.from(l.text).length <= 8))
}

// ---------- 分栏重排(双栏正文 / 旁注栏) ----------

/** 区间归并阈值:左缘距上一栏右缘超过 2em 视为新栏 */
const BAND_MERGE_GAP_EM = 2
/** 段宽超过页宽 62% 视为跨栏(章节标题等),不参与分栏且置顶 */
const WIDE_SPAN_RATIO = 0.62
/** 低于此字符数的栏不成立(页码等噪声) */
const MIN_BAND_CHARS = 30
/** 主栏至少占页内字符的 20% */
const MAIN_BAND_MIN_RATIO = 0.2
/** 旁注栏宽度上限(相对最宽主栏) */
const NOTE_BAND_WIDTH_RATIO = 0.6

interface Band {
  minX: number
  maxX: number
  chars: number
  segments: TextLine[]
}

/**
 * 分栏重排:人教版教材等双栏+旁注版式,按 y 序直读会把左右栏串行混排。
 * 做法:拆段后按 x 区间归并出栏带,识别 2 栏(左栏读完读右栏)与
 * 3 栏且含窄旁注栏(主栏读完再读旁注)两种模式;识别不了则原序返回。
 * 入参/出参均为 buildLines 输出的段流(y 降序、同行 x 升序)。
 */
export function orderPageSegments(segments: TextLine[], pageWidth: number): TextLine[] {
  if (segments.length < 4) return segments
  const spanning: TextLine[] = []
  const bandable: TextLine[] = []
  for (const seg of segments) {
    if (seg.right - seg.x > pageWidth * WIDE_SPAN_RATIO) spanning.push(seg)
    else bandable.push(seg)
  }
  if (bandable.length < 4) return segments

  const sorted = [...bandable].sort((p, q) => p.x - q.x)
  const bands: Band[] = []
  for (const seg of sorted) {
    const last = bands[bands.length - 1]
    const mergeGap = Math.max(14, BAND_MERGE_GAP_EM * seg.fontSize)
    if (last && seg.x <= last.maxX + mergeGap) {
      last.maxX = Math.max(last.maxX, seg.right)
      last.chars += seg.text.length
      last.segments.push(seg)
    } else {
      bands.push({ minX: seg.x, maxX: seg.right, chars: seg.text.length, segments: [seg] })
    }
  }
  const kept = bands.filter((b) => b.chars >= MIN_BAND_CHARS)
  if (kept.length < 2) return segments
  const byX = [...kept].sort((p, q) => p.minX - q.minX)
  const totalChars = bandable.reduce((sum, l) => sum + l.text.length, 0)
  const charRatio = (b: Band) => b.chars / totalChars

  let ordered: TextLine[] | null = null
  if (kept.length === 2) {
    const [left, right] = byX
    if (charRatio(left) >= MAIN_BAND_MIN_RATIO && charRatio(right) >= MAIN_BAND_MIN_RATIO) {
      ordered = [...left.segments, ...right.segments]
    }
  } else if (kept.length === 3) {
    // 窄旁注栏只认最左/最右位,夹在中间视为版式未知
    const widths = byX.map((b) => b.maxX - b.minX)
    const widest = Math.max(...widths)
    const noteIdx = widths.findIndex((w) => w < widest * NOTE_BAND_WIDTH_RATIO)
    if ((noteIdx === 0 || noteIdx === 2) && widths.filter((w) => w < widest * NOTE_BAND_WIDTH_RATIO).length === 1) {
      const main = byX.filter((_, i) => i !== noteIdx)
      const note = byX[noteIdx]
      if (
        charRatio(main[0]) >= MAIN_BAND_MIN_RATIO &&
        charRatio(main[1]) >= MAIN_BAND_MIN_RATIO &&
        charRatio(note) >= 0.04
      ) {
        // 主栏顺序读完,旁注作为补充材料殿后
        ordered = [...main[0].segments, ...main[1].segments, ...note.segments]
      }
    }
  }
  if (!ordered) return segments

  // 跨栏段(章节标题等)置顶按 y 序;其余按栏内 y 序已由输入保证
  const spanSet = new Set(spanning)
  const flow = ordered.filter((l) => !spanSet.has(l))
  return [...spanning, ...flow]
}

/**
 * 行 → 块:段落合并、标题/列表/文档标题识别。
 * 入参 lines 须为 buildLines 的输出(y 降序阅读序);pageWidth 用于居中判断。
 */
export function segmentPage(
  lines: TextLine[],
  pageWidth: number,
  opts: { firstPage?: boolean } = {},
): Block[] {
  const usable = dropPageFurniture(lines)
  if (usable.length === 0) return []

  // 首页文档标题候选:字号统计排除首行,避免封面页大标题主导众数导致漏判
  const titleCandidate = opts.firstPage ? usable[0] : null
  const bodyLines = titleCandidate ? usable.slice(1) : usable
  const bodySize = bodyLines.length > 0 ? bodySizeOf(bodyLines) : bodySizeOf(usable)
  const ctx: SegContext = {
    bodySize,
    pitch: bodyPitchOf(usable),
    maxRight: Math.max(...usable.map((l) => l.right)),
  }

  const blocks: Block[] = []
  let idx = 0
  if (titleCandidate && isDocTitle(titleCandidate, bodySize, pageWidth)) {
    blocks.push({ type: 'title', text: titleCandidate.text })
    idx = 1
  }

  let para: string[] = []
  let paraLeft = 0
  let listBuf: { ordered: boolean; items: string[] } | null = null
  let prevLine: TextLine | null = null

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'paragraph', text: para.reduce(joinWrapped, '') })
      para = []
    }
  }
  const flushList = () => {
    if (listBuf) {
      blocks.push({ type: 'list', ordered: listBuf.ordered, items: listBuf.items })
      listBuf = null
    }
  }

  for (; idx < usable.length; idx++) {
    const line = usable[idx]
    const heading = headingLevelOf(line, ctx.bodySize)
    if (heading) {
      flushPara()
      flushList()
      blocks.push({ type: 'heading', level: heading, text: line.text })
      prevLine = line
      continue
    }
    const lm = matchListPrefix(line.text)
    if (lm) {
      flushPara()
      if (!listBuf || listBuf.ordered !== lm.ordered) {
        flushList()
        listBuf = { ordered: lm.ordered, items: [] }
      }
      listBuf.items.push(lm.content)
      prevLine = line
      continue
    }
    flushList()
    if (para.length === 0) {
      para = [line.text]
      paraLeft = line.x
    } else if (prevLine && isParagraphBreak(prevLine, line, paraLeft, ctx)) {
      flushPara()
      para = [line.text]
      paraLeft = line.x
    } else {
      para.push(line.text)
      paraLeft = Math.min(paraLeft, line.x)
    }
    prevLine = line
  }
  flushPara()
  flushList()
  return blocks
}
