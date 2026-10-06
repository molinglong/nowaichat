import { isIdentity, STAGE_LADDER, type Identity } from "./academic"
import { GENERAL_FIELDS, generalFieldLabel, type GeneralFieldId, type GeneralFields } from "./general"

/**
 * 对话式采集的纯函数层（波2）：问题编排、自由文本抽取、正题让位判定。
 *
 * 三条设计约束：
 * 1. 抽不到就不落档、不猜。误判（把「我表哥高三」记成用户高三）比少记一维代价高得多，
 *    因为档案每轮都进 system prompt，写错一次会被反复引用。
 * 2. 已落档的值不被抽取覆盖（first-wins）。要改走「就地改」，由用户主动表态。
 * 3. 用户一发正题立刻让位。采集是给 AI 补事实，不是插队打断用户真正要做的事。
 */

/** 硬上限：一次采集最多问 9 句，问满就收口，剩下的下次再说 */
export const PROBE_MAX_QUESTIONS = 9

/** 跳过之后多久重新提示（毫秒） */
export const PROBE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

/** localStorage 键前缀：按 userId 分桶，换账号不复用静默状态 */
export const PROBE_SNOOZE_KEY_PREFIX = "profile-probe-snooze:"

const ASKS: Record<GeneralFieldId, string> = {
  identity: "先问一句：你现在是读书、上班，还是别的？",
  stage: "读书的话现在初几、高几？我按这个判断哪些内容算超纲。",
  subjectTrack: "选科是哪几门？没学的章节我不给你讲深。",
  occupation: "方便说下做什么吗？知道方向我才好用你熟悉的例子讲。",
  depth: "讲题你希望我怎么讲？",
  goal: "最后一条：眼下最想解决的是什么？",
}

/** 询问顺序：身份决定后续问哪几维，深度/目标恒问 */
const ORDER: GeneralFieldId[] = ["identity", "stage", "subjectTrack", "occupation", "depth", "goal"]

/** 学段/选科只在学生身上有意义；职业只对上班族、自由职业问（学生不必交代家长职业） */
function appliesTo(fieldId: GeneralFieldId, identity: Identity | null): boolean {
  if (fieldId === "stage" || fieldId === "subjectTrack") return identity === "student"
  if (fieldId === "occupation") return identity === "worker" || identity === "freelance"
  return true
}

export function probeIdentity(fields: GeneralFields): Identity | null {
  return isIdentity(fields.identity) ? fields.identity : null
}

/** 按身份该采哪几维（不看是否已答） */
export function applicableProbeFields(answered: GeneralFields): GeneralFieldId[] {
  return ORDER.filter((id) => appliesTo(id, probeIdentity(answered)))
}

/** 还该问哪几维：已答的、按身份不适用的都出队 */
export function pendingProbeFields(answered: GeneralFields): GeneralFieldId[] {
  return applicableProbeFields(answered).filter((id) => !answered[id])
}

export function probeFieldLabel(fieldId: GeneralFieldId): string {
  return GENERAL_FIELDS.find((f) => f.id === fieldId)?.label ?? fieldId
}

export interface ProbeQuestion {
  fieldId: GeneralFieldId
  /** 短标签，快选行上方显示「我的年级」这类 */
  label: string
  ask: string
  options: { value: string; label: string }[]
  /** 无 options 的字段（职业）走整行输入 */
  freeText: boolean
  max?: number
}

/** 单维构造：界面「就地改」要能直接问到某一维，不受已答与否限制 */
export function buildProbeQuestion(fieldId: GeneralFieldId): ProbeQuestion {
  const def = GENERAL_FIELDS.find((f) => f.id === fieldId)!
  return {
    fieldId,
    label: `我的${def.label}`,
    ask: ASKS[fieldId],
    options: (def.options ?? []).slice(),
    freeText: !def.options,
    max: def.max,
  }
}

/**
 * 采集队列。适用性一律按「当前档案」算——就地改身份后队列要立刻分岔
 * （改成上班族就该问职业，不再追问学段/选科）。
 * - reask：这几维虽已落档，但本轮重新上架（到期复核 / 就地改）。
 * - only：到期复核用「只过已答的那几条」，避免复核顺带把没答过的也问一遍。
 * - asked：本轮已经问过的不再重复排。
 */
export function probeQueue(
  fields: GeneralFields,
  asked: GeneralFieldId[],
  reask: GeneralFieldId[],
  only?: GeneralFieldId[]
): ProbeQuestion[] {
  return applicableProbeFields(fields)
    .filter((id) => (only ? only.includes(id) : reask.includes(id) || !fields[id]))
    .filter((id) => !asked.includes(id))
    .map(buildProbeQuestion)
}

/** 问满 9 句即收口：返回还能问的条数（0 = 该停） */
export function probeQuotaLeft(askedCount: number): number {
  return Math.max(0, PROBE_MAX_QUESTIONS - askedCount)
}

/**
 * 转述他人/第三方的说法，不能算用户本人的事实。
 * 命中词前的小窗口里看到称谓就放弃；命中词紧跟「说」也算引用他人
 * （「老师说高一不考」里的老师不是用户本人）。宁可少记，不记错。
 */
const OTHERS = /(表哥|表姐|表弟|表妹|同学|朋友|哥们|闺蜜|哥哥|姐姐|弟弟|妹妹|爸爸|妈妈|老师说|他说|她说|人家)/
function isSecondHand(text: string, match: { index: number; 0: string }): boolean {
  const before = text.slice(Math.max(0, match.index - 6), match.index)
  const after = text.slice(match.index + match[0].length, match.index + match[0].length + 1)
  return OTHERS.test(before) || after === "说"
}

const SUBJECT_NAMES = ["物理", "化学", "生物", "历史", "政治", "地理"] as const

/** 三科组合必须在已知路线表内，表外（如「物史地」）不猜成新档位 */
function trackFromSubjects(subjects: string[]): string | null {
  if (subjects.length !== 3) return null
  const set = new Set(subjects)
  const tracks: Record<string, string[]> = {
    "phys-chem-bio": ["物理", "化学", "生物"],
    "phys-chem-geo": ["物理", "化学", "地理"],
    "hist-pol-geo": ["历史", "政治", "地理"],
  }
  for (const [value, list] of Object.entries(tracks)) {
    if (list.every((s) => set.has(s)) && set.size === list.length) return value
  }
  return null
}

export interface ProbeHit {
  fieldId: GeneralFieldId
  value: string
  /** 回显用的中文文案，直接取自档位表，避免界面再拼一遍 */
  label: string
}

export interface ExtractResult {
  hits: ProbeHit[]
  /** 抽到了但该维已落档：不回显成"新记住"，界面另作提示 */
  kept: ProbeHit[]
  /** 抽到了但判为他人转述 / 档位表外：不落档 */
  refused: string[]
}

function hit(fieldId: GeneralFieldId, value: string): ProbeHit {
  return { fieldId, value, label: generalFieldLabel(fieldId, value) }
}

/** 界面回显用：枚举值 → 档位中文，避免把 phys-chem-bio 这种直接摊给用户 */
export function probeHit(fieldId: GeneralFieldId, value: string): ProbeHit {
  return hit(fieldId, value)
}

/**
 * 自由文本 → 档案档位。只覆盖枚举字段：职业这类自由文本一旦抽取就最容易记错，
 * 交给面板的整行输入，由用户自己敲。
 */
export function extractGeneralFields(text: string, answered: GeneralFields): ExtractResult {
  const raw = String(text ?? "")
  const hits: ProbeHit[] = []
  const kept: ProbeHit[] = []
  const refused: string[] = []
  const push = (h: ProbeHit) => {
    if (answered[h.fieldId]) kept.push(h)
    else hits.push(h)
  }

  // 身份按证据强弱取第一条：教师/上班这类主动自述优先于「话里带学段词」这种间接证据，
  // 否则「我教高二」会被写成学生；所有候选都要过他人转述检查，「我朋友是学生」同样不落档。
  const stageMatch = new RegExp(`(${STAGE_LADDER.join("|")})`).exec(raw)
  const identityCandidates: { value: string; match: RegExpExecArray }[] = []
  const pushCandidate = (re: RegExp, value: string) => {
    const m = re.exec(raw)
    if (m) identityCandidates.push({ value, match: m })
  }
  pushCandidate(/(老师|教师|任教|教书)/, "teacher")
  pushCandidate(/(上班|打工|公司|在职|国企|公务员|事业编)/, "worker")
  pushCandidate(/(自由职业|自由接单|独立开发|全职做)/, "freelance")
  pushCandidate(/(学生|在读|上学|读书|初中|高中)/, "student")
  if (stageMatch) identityCandidates.push({ value: "student", match: stageMatch })

  const identityHit = identityCandidates.find((c) => !isSecondHand(raw, c.match))
  if (identityHit) push(hit("identity", identityHit.value))

  if (stageMatch) {
    if (isSecondHand(raw, stageMatch)) refused.push("stage")
    else push(hit("stage", stageMatch[1]))
  }

  const trackShort: Record<string, string> = {
    物化生: "phys-chem-bio",
    物化地: "phys-chem-geo",
    史政地: "hist-pol-geo",
    政史地: "hist-pol-geo",
  }
  const shortKey = Object.keys(trackShort).find((k) => raw.includes(k))
  if (shortKey) {
    push(hit("subjectTrack", trackShort[shortKey]))
  } else if (/(还没|未|不)[分科]/.test(raw)) {
    push(hit("subjectTrack", "not-split"))
  } else {
    const subjects = SUBJECT_NAMES.filter((s) => raw.includes(s))
    if (subjects.length) {
      const track = trackFromSubjects(subjects)
      if (track) push(hit("subjectTrack", track))
      else refused.push("subjectTrack")
    }
  }

  if (/(步骤|写全|详细|细一点|一步步)/.test(raw)) push(hit("depth", "full-steps"))
  else if (/(思路|简单点|概要|结论先|直接给答案)/.test(raw)) push(hit("depth", "ideas-only"))
  else if (/(适中|跳步|差不多就行)/.test(raw)) push(hit("depth", "medium"))

  if (/(期末|不拉分|别拖后腿)/.test(raw)) push(hit("goal", "no-drag"))
  else if (/(一本|双一流|高考|竞赛|上岸)/.test(raw)) push(hit("goal", "first-tier"))
  else if (/(兴趣|爱好|玩玩|自己想看)/.test(raw)) push(hit("goal", "interest"))

  return { hits, kept, refused }
}

/** 回显文案：「身份 学生 · 学段 高二」 */
export function describeHits(hits: ProbeHit[]): string {
  return hits.map((h) => `${probeFieldLabel(h.fieldId)} ${h.label}`).join(" · ")
}

/**
 * 正题判定：用户是来干活的，不是来填表的。命中任一条即让位（本条按普通对话发出去，
 * 采集就地停下、不追问）。
 */
export function looksLikeRealTopic(text: string): boolean {
  const raw = String(text ?? "").trim()
  if (!raw) return false
  if (/^(直答[：:]|快答[：:]|@)/.test(raw)) return true
  if (/[?？]/.test(raw)) return true
  if (/(请|帮我|给我|麻烦).{0,6}(解释|讲讲|分析|写|改|翻|译|算|解|列|总结|检查|看看)/.test(raw)) return true
  if (/(为什么|怎么|如何|什么意思|区别)/.test(raw)) return true
  // 题面类词要配上文长度：单个「题」字可能只是「讲题步骤全写」这种回答
  if (/(公式|方程|函数|导数|单词|翻译|作文|题)/.test(raw) && raw.length >= 12) return true
  if (/[=+\-*/^%]<|\\frac|\\sum|\$\$/.test(raw)) return true
  if (/^https?:\/\//.test(raw)) return true
  return false
}

/** 跳过后的静默判定：7 天内不再提示，到期自动恢复 */
export function probeSnoozed(snoozedAt: number | null | undefined, now: number): boolean {
  if (!snoozedAt || snoozedAt <= 0) return false
  if (now < snoozedAt) return true // 时钟回拨时不无限静默
  return now - snoozedAt < PROBE_SNOOZE_MS
}
