/**
 * 学年推算纯函数（通用档案 波1）。
 *
 * 契约：这里只「推算」，不写库、不改写用户确认值。推算结果一律带
 * derived=true 语义（note 前缀「系统推算」），展示层必须与确认值区分，
 * 且只有用户点确认后才回写档案。
 */

export const ACADEMIC_TIME_ZONE = "Asia/Shanghai"

/** 学年起点：9 月 1 日（上海时区） */
const SCHOOL_YEAR_START_MONTH = 9
const SCHOOL_YEAR_START_DAY = 1

/** 换学年确认一次之外的打工侧提醒间隔 */
export const RECONFIRM_AFTER_DAYS = 180

export type Identity = "student" | "teacher" | "worker" | "freelance" | "other"

export const IDENTITIES: readonly { id: Identity; label: string }[] = [
  { id: "student", label: "学生" },
  { id: "teacher", label: "教师" },
  { id: "worker", label: "上班族" },
  { id: "freelance", label: "自由职业" },
  { id: "other", label: "其他" },
] as const

const IDENTITY_IDS = IDENTITIES.map((i) => i.id) as string[]

export function isIdentity(value: unknown): value is Identity {
  return typeof value === "string" && IDENTITY_IDS.includes(value)
}

/**
 * 升学阶梯。初三→高一是同类升档，高三→大一 不是：中间隔着升学考试与录取结果，
 * 自动 +1 会把没考上的用户写成大学生。大四同理走毕业态。
 */
export const STAGE_LADDER = [
  "初一",
  "初二",
  "初三",
  "高一",
  "高二",
  "高三",
  "大一",
  "大二",
  "大三",
  "大四",
] as const

export type Stage = (typeof STAGE_LADDER)[number]

const GRADUATE_AFTER: readonly string[] = ["高三", "大四"]

export type StageAdvance =
  | { kind: "advance"; stage: Stage }
  | { kind: "graduate"; from: Stage }
  | { kind: "unknown"; from: string }

export function nextStage(stage: string): StageAdvance {
  const index = STAGE_LADDER.indexOf(stage as Stage)
  if (index < 0) return { kind: "unknown", from: stage }
  if (GRADUATE_AFTER.includes(stage)) return { kind: "graduate", from: stage as Stage }
  return { kind: "advance", stage: STAGE_LADDER[index + 1] }
}

export interface CalendarParts {
  year: number
  month: number
  day: number
}

/**
 * 按上海时区取年月日。VPS 容器常为 UTC，裸用 getMonth() 会在
 * 9/1 00:00–08:00（上海）这段把已开学判成还没开学，整份档案的学段推错一年。
 */
export function shanghaiParts(at: Date): CalendarParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ACADEMIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at)
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0")
  return { year: pick("year"), month: pick("month"), day: pick("day") }
}

/** 当前所在学年的起始年份：9/1 之前属于上一学年 */
export function schoolYearStartYear(at: Date): number {
  const { year, month, day } = shanghaiParts(at)
  const started = month > SCHOOL_YEAR_START_MONTH ||
    (month === SCHOOL_YEAR_START_MONTH && day >= SCHOOL_YEAR_START_DAY)
  return started ? year : year - 1
}

export function schoolYearLabel(startYear: number): string {
  return `${startYear}—${startYear + 1} 学年`
}

export interface DerivedStage {
  /** keep=未到学年边界；advance=可推算出新学段；graduate=推到毕业档；confirm=无法推算，需用户表态 */
  kind: "keep" | "advance" | "graduate" | "confirm"
  /** graduate 时为 null（已无在读学段）；confirm 时回显原值 */
  stage: Stage | null
  steps: number
  /** keep 以外都以「系统推算」开头，展示层不得当作确认值 */
  note: string
}

/**
 * 用确认过的学段 + 确认时间推算「现在应当是几年级」。
 * 步数 = 两个时间点之间跨过的学年边界数，跨一年升一档。
 */
export function deriveStage(
  confirmedStage: string | null | undefined,
  confirmedAt: Date | null | undefined,
  now: Date
): DerivedStage {
  if (!confirmedStage || !confirmedAt || !STAGE_LADDER.includes(confirmedStage as Stage)) {
    return {
      kind: "confirm",
      stage: (confirmedStage as Stage) ?? null,
      steps: 0,
      note: "系统推算：学段缺失或不在已知阶梯内，需要用户表态",
    }
  }
  const steps = schoolYearStartYear(now) - schoolYearStartYear(confirmedAt)
  if (steps <= 0) {
    return { kind: "keep", stage: confirmedStage as Stage, steps: 0, note: "" }
  }
  let current = confirmedStage as Stage
  let advanced = 0
  for (let i = 0; i < steps; i++) {
    const next = nextStage(current)
    if (next.kind === "graduate") {
      return {
        kind: "graduate",
        stage: null,
        steps: advanced,
        note: `系统推算：${current} 之后无自动递进档（升学需录取结果），已到达毕业态`,
      }
    }
    if (next.kind === "unknown") {
      return {
        kind: "confirm",
        stage: current,
        steps: advanced,
        note: `系统推算：${current} 之后无法自动递进，需要用户确认`,
      }
    }
    current = next.stage
    advanced++
  }
  return {
    kind: "advance",
    stage: current,
    steps: advanced,
    note: `系统推算：按 ${schoolYearStartYear(confirmedAt)} 学年确认的 ${confirmedStage} 顺推 ${advanced} 档`,
  }
}

export type RefreshReason = "first" | "school-year" | "interval" | null

export interface RefreshState {
  due: boolean
  reason: RefreshReason
}

/**
 * 档案到期判定（每次请求惰性算，不做定时任务、不做推送）。
 * 提醒节奏按身份相位分档，不统一半年：
 * 学生/教师跟学年（9/1 一次），上班族/自由职业跟 180 天，其他不打扰。
 */
export function profileRefreshDue(
  identity: Identity | null | undefined,
  lastConfirmedAt: Date | null | undefined,
  now: Date
): RefreshState {
  if (!isIdentity(identity)) return { due: false, reason: null }
  if (identity === "other") return { due: false, reason: null }
  if (!lastConfirmedAt) return { due: true, reason: "first" }

  if (identity === "student" || identity === "teacher") {
    return schoolYearStartYear(now) > schoolYearStartYear(lastConfirmedAt)
      ? { due: true, reason: "school-year" }
      : { due: false, reason: null }
  }

  const elapsedDays = (now.getTime() - lastConfirmedAt.getTime()) / 86_400_000
  return elapsedDays >= RECONFIRM_AFTER_DAYS
    ? { due: true, reason: "interval" }
    : { due: false, reason: null }
}
