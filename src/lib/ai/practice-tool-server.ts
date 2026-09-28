/**
 * 题库练题工具——服务端工厂（server-only，依赖 prisma）。
 *
 * 常量/schema/类型在 practice-tool.ts（isomorphic，仅依赖 zod，
 * ToolCallCard 可安全 import）；抽题与落库核心在 lib/study/question-bank.ts。
 */
import { tool } from 'ai'
import {
  practiceInputSchema,
  recordInputSchema,
  type PracticeToolOutput,
  type RecordToolOutput,
} from './practice-tool'
import { drawQuestions, recordPracticeAttempt } from '@/lib/study/question-bank'

/**
 * 抽题工具：返回题目 + 答案（答案仅供模型判分，note 中严禁提前展示）。
 * @param userId 抽题范围严格限定当前用户的题库（多用户数据主权）
 */
export function createPracticeTool(userId: string) {
  return tool({
    description:
      '题库抽题工具。当用户想练题/刷题/被考（「练几道」「考考我」「来道解答题」）时调用，从用户的题库中按考点/年份/难度/题型随机抽题。返回题干与答案（答案仅供你判分，严禁提前展示给用户）。',
    inputSchema: practiceInputSchema,
    execute: async (input): Promise<PracticeToolOutput> => {
      try {
        const items = await drawQuestions(userId, input)
        if (!items.length) {
          return {
            count: 0,
            items: [],
            note: '题库里没有符合条件的题目。请如实告知用户题库暂无匹配题目（可建议放宽考点/年份条件，或先在题库里积累题目），不要自行编题顶替。',
          }
        }
        return {
          count: items.length,
          items,
          note: [
            '本轮回复只呈现题目本身，严禁包含答案、解析或 :::answer 块（答案仅供你判分）。',
            '逐字转写题干与选项（选择题必须保留每个选项行），不要改写、翻译或省略。',
            '每题用试卷块渲染：选择题 :::choice、解答题 :::question；块内首行写出处行「参考 <该题 refLine 字段原样>」。',
            '题目全部给出后请用户按题号作答；用户作答前不要提示解法。',
          ].join('\n'),
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知抽题错误'
        console.error('[practice-tool]', message)
        return {
          count: 0,
          items: [],
          error: message,
          note: '抽题暂时不可用。请如实告知用户抽题失败，不要编造题目顶替。',
        }
      }
    },
  })
}

/**
 * 判分回传工具：答错自动转错题本（StudyNote，FSRS 队列），同题幂等不重复建卡。
 * @param userId 归属校验：非本人题目按未找到处理
 */
export function createRecordPracticeTool(userId: string) {
  return tool({
    description:
      '练习判分回传工具。用户对抽到的题目作答、你完成判分后调用，批量上报每题对错（只传用户已作答的题）；答错的题会自动收进错题本。questionId 必须原样使用 practice_questions 返回的 id，不得编造。',
    inputSchema: recordInputSchema,
    execute: async ({ items }): Promise<RecordToolOutput> => {
      try {
        let wrongRecorded = 0
        let existingReused = 0
        let missing = 0
        for (const it of items) {
          const r = await recordPracticeAttempt(userId, it.questionId, it.result, it.userAnswer)
          if (r.outcome === 'notfound') missing++
          else if (r.outcome === 'card-created') wrongRecorded++
          else if (r.outcome === 'card-existing') existingReused++
        }
        const processed = items.length - missing
        const parts = [`已记录 ${processed} 题作答`]
        if (wrongRecorded) parts.push(`新收 ${wrongRecorded} 道错题进错题本`)
        if (existingReused) parts.push(`${existingReused} 道此前已在错题本`)
        if (missing) parts.push(`${missing} 题未在题库中找到（未记录）`)
        return {
          processed,
          wrongRecorded,
          existingReused,
          missing,
          note: `${parts.join('；')}。请告知用户做对/做错几道，并对每道错题给出正确解法讲解（可引用课本或知识库佐证）。`,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知记录错误'
        console.error('[record-practice-tool]', message)
        return {
          processed: 0,
          wrongRecorded: 0,
          existingReused: 0,
          missing: 0,
          error: message,
          note: '作答结果记录失败。请如实告知用户稍后重试，不要声称已收进错题本。',
        }
      }
    },
  })
}
