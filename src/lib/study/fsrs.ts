/**
 * ts-fsrs 薄封装:StudyNote 行的 FSRS 字段 ↔ ts-fsrs Card 互转 + 2 键自评排期。
 * 字段对应关系见 schema.prisma 的 StudyNote 注释。
 * 自评 2 键映射:想起来了 = Good(3) / 卡住了 = Again(1)。
 * 掌握度规则:Good → +0.15(封顶 1);Again → -0.25(保底 0)。
 */
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
} from 'ts-fsrs'

export type ReviewRating = 'again' | 'good'

/** StudyNote 行里参与 FSRS 计算的字段(调用方直接传 prisma 行) */
export interface FsrsInput {
  mastery: number
  stability: number | null
  difficulty: number | null
  state: number
  dueAt: Date | null
  lastReviewAt: Date | null
  reps: number
  lapses: number
}

/** 模块级单例:默认参数 + fuzz 抖动(接近 Anki 手感) */
const scheduler = fsrs(generatorParameters({ enable_fuzz: true }))

/** DB 行 → ts-fsrs Card(重建复习状态;elapsed/scheduled/learning_steps 为重建近似值,对排期影响可忽略) */
export function toCard(f: FsrsInput): Card {
  return {
    due: f.dueAt ?? new Date(),
    stability: f.stability ?? 0,
    difficulty: f.difficulty ?? 0,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: f.reps,
    lapses: f.lapses,
    learning_steps: 0,
    state: (f.state ?? 0) as State,
    last_review: f.lastReviewAt ?? undefined,
  }
}

/** 新错题的初始 FSRS 状态(due = now → 建卡即进入今日复习队列) */
export function newCardFields(now = new Date()) {
  const c = createEmptyCard(now)
  return {
    stability: c.stability,
    difficulty: c.difficulty,
    state: c.state as number,
    dueAt: c.due,
    reps: 0,
    lapses: 0,
  }
}

/** 2 键自评 → FSRS 新状态 + 掌握度更新 + 落库用的 rating 枚举值(1=Again 3=Good) */
export function scheduleReview(f: FsrsInput, rating: ReviewRating, now = new Date()) {
  const card = toCard(f)
  const ratingValue = rating === 'good' ? Rating.Good : Rating.Again
  const next = scheduler.repeat(card, now)[ratingValue].card
  const mastery =
    rating === 'good'
      ? Math.min(1, f.mastery + 0.15)
      : Math.max(0, f.mastery - 0.25)
  return {
    stability: next.stability,
    difficulty: next.difficulty,
    state: next.state as number,
    dueAt: next.due,
    lastReviewAt: now,
    reps: next.reps,
    lapses: next.lapses,
    mastery,
    ratingValue: ratingValue as number,
  }
}
