/**
 * 试卷块（材料/设问/作答）markdown 约定 —— 纯文本层解析，无 React 依赖。
 *
 * 材料题里材料/设问/作答混在一坨难读，约定 AI 按试卷结构分块输出：
 *   :::material …（材料原文）… :::
 *   :::question …（设问+分值）… :::
 *   :::answer …（分点作答）… :::
 *   :::poem …（诗歌原文，一句一行）… :::
 *   :::essay …（作文纸：首行标题，正文段落，末行「全文约 X 字」）… :::
 * 解析为片段流后由 MarkdownRenderer 分别渲染成试卷卡片；
 * 关键词双色标注（==术语== / @@材料词@@）在渲染层处理，见 MarkdownRenderer.tsx。
 */

export type ExamKind = 'choice' | 'material' | 'question' | 'answer' | 'poem' | 'essay'

export type ExamSegment =
  | { type: 'md'; text: string }
  | { type: 'exam'; kind: ExamKind; text: string }

export interface ExamChoiceOption {
  /** 大写选项字母（A-F） */
  letter: string
  text: string
}

export interface ExamChoice {
  stem: string
  options: ExamChoiceOption[]
}

/** 选项行：A. / A、 / A． / A: 等前缀（允许首尾空白），内容非空才算选项 */
const CHOICE_OPTION_RE = /^\s*([A-Fa-f])[.、．:：]\s*(.+)$/

const EXAM_OPEN_RE = /^:::(choice|material|question|answer|poem|essay)\s*$/
const EXAM_CLOSE_RE = /^:::\s*$/

/**
 * 选择题块内解析：题干与选项分离。
 * 以「A.」等前缀的行识别为选项（字母统一大写），其余行归入题干；
 * 选项内容不连续（中间夹空行）也能正确归组。
 */
export function parseChoice(text: string): ExamChoice {
  const stem: string[] = []
  const options: ExamChoiceOption[] = []
  for (const line of text.split('\n')) {
    const m = line.match(CHOICE_OPTION_RE)
    if (m) {
      options.push({ letter: m[1].toUpperCase(), text: m[2].trim() })
    } else {
      stem.push(line)
    }
  }
  return { stem: stem.join('\n').trim(), options }
}

export interface ExamEssay {
  /** 自拟标题（块内首行，渲染层居中疏排） */
  title: string
  /** 正文（继续走完整 markdown 渲染，双色标注照常生效） */
  body: string
  /** 历史消息中模型自写的字数行（兼容带括号），提取剥离后不再展示——徽标改为前端实时计数 */
  wordCount: string
}

/**
 * 作文纸块内解析：首行为标题，末行以「全文约」开头的行（历史消息遗留，可带括号）剥离不展示，
 * 其余为正文。识别失败时各段回空/并入正文，不吞内容。
 */
export function parseEssay(text: string): ExamEssay {
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  const title = i < lines.length ? lines[i].trim() : ''
  const titleIdx = i
  let j = lines.length - 1
  while (j > titleIdx && !lines[j].trim()) j--
  let wordCount = ''
  if (j > titleIdx) {
    const last = lines[j].trim().replace(/^[（(]\s*/, '').replace(/\s*[）)]$/, '')
    if (/^全文约/.test(last)) {
      wordCount = last
      j--
    }
  }
  const body = lines.slice(titleIdx + 1, j + 1).join('\n').trim()
  return { title, body, wordCount }
}

/**
 * 作文字数前端实时计数（作文纸占格口径）：标题+正文合并，按字符数计、含标点，
 * 剔除空白与行内语法符（== == / @@ @@ / ** / ~~），与模型自写估算无关。
 */
export function countEssayChars(title: string, body: string): number {
  const cleaned = (title + '\n' + body)
    .replace(/(==+|@@+|\*{2,}|~{2,})/g, '')
    .replace(/\s/g, '')
  return Array.from(cleaned).length
}

/**
 * 作文一键复制的纯文本：标题 + 空行 + 正文，剥除行内语法符（== == / @@ @@ / ** / ~~），
 * 保留文字、标点与段落结构，复制出来可直接誊抄或粘贴。
 */
export function essayToPlainText(title: string, body: string): string {
  return (title + '\n\n' + body).replace(/(==+|@@+|\*{2,}|~{2,})/g, '')
}

export interface ExamSourceRef {
  /** 出处定位，如「§1.2.3 例3(2)」（不含「参考」前缀与科目标签） */
  ref: string
  /** 科目标签映射（如「·数学」→ math），未写则 null（入库时降级 other） */
  subject: string | null
}

/** 出题协议出处行：块内首行「参考 §1.2.3 例3(2)·数学」（科目标签可选） */
const SOURCE_REF_RE = /^\s*参考[::\s]*([^·]+?)(?:\s*·\s*(数学|语文|英语|物理|化学|生物))?\s*$/

const REF_SUBJECT_MAP: Record<string, string> = {
  数学: 'math',
  语文: 'chinese',
  英语: 'english',
  物理: 'physics',
  化学: 'chemistry',
  生物: 'biology',
}

/**
 * 题块出处行解析：剥离首行「参考 §x.x·科目」，供渲染层徽标与收进题库联动。
 * 仅在首行匹配成功时剥离；普通题干不受影响。流式中出处行先到、正文后到，
 * 每次重算即可（幂等无状态）。
 */
export function parseSourceRefLine(text: string): { sourceRef: ExamSourceRef | null; body: string } {
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  if (i < lines.length) {
    const m = lines[i].match(SOURCE_REF_RE)
    if (m) {
      const subjectTag = m[2] ? REF_SUBJECT_MAP[m[2]] ?? null : null
      return {
        sourceRef: { ref: m[1].trim(), subject: subjectTag },
        body: lines.slice(i + 1).join('\n').trim(),
      }
    }
  }
  return { sourceRef: null, body: text }
}

/**
 * 按 ::: 块切分 markdown 为片段流；无 ::: 时单段返回（渲染路径与旧版一致）。
 * - fenced code 内的 ::: 不识别（代码示例不误伤）
 * - 未闭合块兜底回普通文本（连 ::: 开行一起还原），不吞内容
 */
export function parseExamSegments(md: string): ExamSegment[] {
  if (!md.includes(':::')) return [{ type: 'md', text: md }]
  const segments: ExamSegment[] = []
  let mdBuf: string[] = []
  let examKind: ExamKind | null = null
  let examBuf: string[] = []
  let inFence = false
  let fenceChar = ''
  const push = (line: string) => (examKind ? examBuf : mdBuf).push(line)
  const flushMd = () => {
    if (mdBuf.length && mdBuf.some((l) => l.trim())) {
      segments.push({ type: 'md', text: mdBuf.join('\n') })
      mdBuf = []
    }
  }
  for (const line of md.split('\n')) {
    const fence = line.trim().match(/^(`{3,}|~{3,})/)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceChar = fence[1][0]
      } else if (fence[1][0] === fenceChar) {
        inFence = false
        fenceChar = ''
      }
      push(line)
      continue
    }
    if (inFence) {
      push(line)
      continue
    }
    if (!examKind) {
      const open = line.match(EXAM_OPEN_RE)
      if (open) {
        flushMd()
        examKind = open[1] as ExamKind
      } else {
        mdBuf.push(line)
      }
    } else if (EXAM_CLOSE_RE.test(line)) {
      segments.push({ type: 'exam', kind: examKind, text: examBuf.join('\n') })
      examBuf = []
      examKind = null
    } else {
      examBuf.push(line)
    }
  }
  if (examKind) mdBuf.push(`:::${examKind}`, ...examBuf)
  flushMd()
  return segments
}
