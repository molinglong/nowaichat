/**
 * 题库练题工具（practice_questions / record_practice）—— 纯常量模块（isomorphic）
 *
 * ⚠ 本文件禁止 import prisma/ai 等服务端依赖（ToolCallCard 只需要两个工具名，
 * 混入会连 pg 一起打进客户端 bundle 报 fs 错误）；
 * 工具工厂在 practice-tool-server.ts，抽题/落库核心在 lib/study/question-bank.ts。
 *
 * 双工具一流程：practice_questions 抽题（答案只进模型上下文供判分，严禁提前给用户）
 * → 用户在对话里作答 → record_practice 回传判分（答错自动转错题本，
 * 与 /api/study/quiz/practice 同一落库口径）。
 */
import { z } from 'zod'

export const PRACTICE_TOOL_NAME = 'practice_questions'
export const RECORD_TOOL_NAME = 'record_practice'

export const practiceInputSchema = z.object({
  subject: z
    .string()
    .max(20)
    .optional()
    .describe(
      '学科过滤(math/chinese/english/physics/chemistry/biology/history/geography/politics/other)；用户没提就不传'
    ),
  topic: z
    .string()
    .max(12)
    .optional()
    .describe('考点短语过滤，按包含匹配，如「集合的并集」「古典概型」；用户没提就不传'),
  year: z
    .string()
    .max(6)
    .optional()
    .describe('真题年份过滤（4 位数字，如「2022」），按出处包含匹配；用户没提就不传'),
  difficulty: z
    .enum(['basic', 'medium', 'hard'])
    .optional()
    .describe('难度过滤：basic=基础 medium=中档 hard=较难；用户没提就不传'),
  kind: z
    .enum(['choice', 'answer'])
    .optional()
    .describe('题型过滤：choice=选择题 answer=解答题；用户没提就不传'),
  count: z.number().int().min(1).max(5).optional().describe('抽题数量，默认 3，最多 5'),
})

export type PracticeToolInput = z.infer<typeof practiceInputSchema>

export const recordInputSchema = z.object({
  items: z
    .array(
      z.object({
        questionId: z.string().min(1).describe('practice_questions 返回的题目 id，必须原样使用，不得编造'),
        result: z.enum(['right', 'wrong']).describe('该题判分结果'),
        userAnswer: z
          .string()
          .max(2000)
          .optional()
          .describe('用户原话作答（答错时必填，会随错题一起留痕）'),
      })
    )
    .min(1)
    .max(10)
    .describe('本轮已判分的题目列表（只传用户已作答的题）'),
})

export type RecordToolInput = z.infer<typeof recordInputSchema>

export interface PracticeItem {
  id: string
  kind: string
  stem: string
  /** 答案+解析：仅供模型判分，渲染时严禁提前展示 */
  answer: string
  topic: string | null
  difficulty: string
  /**
   * 出处行文本（源自 Question.sourceRef 末段，不含「·」——渲染层正则要求）；
   * 模型需原样写进题块首行「参考 {refLine}」，前缀「题库」同时让渲染层
   * 知道这是题库原题、不再显示「收进题库」按钮。
   */
  refLine: string
}

export interface PracticeToolOutput {
  count: number
  items: PracticeItem[]
  note: string
  error?: string
}

export interface RecordToolOutput {
  processed: number
  wrongRecorded: number
  existingReused: number
  missing: number
  note: string
  error?: string
}
