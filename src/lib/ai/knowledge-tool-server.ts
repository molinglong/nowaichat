/**
 * 课本知识库检索工具——服务端工厂（server-only，依赖 prisma）。
 *
 * 常量/schema/类型在 knowledge-tool.ts（isomorphic，仅依赖 zod，
 * ToolCallCard 可安全 import）；本文件放 createKnowledgeTool、
 * searchKnowledgeChunks（检索共享核心）与 hasKnowledgeChunks，
 * 禁止被客户端组件引用。
 */
import { tool } from 'ai'
import { prisma } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import {
  knowledgeInputSchema,
  type KnowledgeHit,
  type KnowledgeToolOutput,
} from './knowledge-tool'

/** 每块返回给模型的正文截断长度(检索引用够用,控制 token) */
const HIT_CONTENT_LIMIT = 800
/** 拉取候选数(粗筛)与返回数(精排) */
const FETCH_LIMIT = 24
const RESULT_LIMIT = 5

/** $queryRaw 行结构(列别名与 SQL 对齐) */
type RawChunkRow = {
  content: string
  heading: string
  chapter: string | null
  section: string | null
  sortOrder: number
  docTitle: string
  kind: string
}

/**
 * 创建课本知识库检索工具。
 * @param userId 检索范围严格限定当前用户的切块(多用户数据主权)
 * @param preferredSubject 面具学科倾向(半绑定),仅写入能力段文案,不影响 execute 行为
 */
export function createKnowledgeTool(userId: string, preferredSubject?: string) {
  void preferredSubject // 半绑定作用于能力段文案;execute 层不过滤,保留参数位便于后续收紧
  return tool({
    description:
      '课本知识库检索工具。检索用户上传的课本(教材原文)与资料(答题模板/提纲/讲义)。解答或讲评任何学科题目、引用教材原文、解释课本概念/公式/定理、找答题套路、用户要求翻书时使用——凡题目涉及具体史实/知识点,无论多有把握,第一个动作就是调用本工具。输入 2-4 个检索关键词(提考点词,不抄题面表面词)，返回最相关的原文片段（含来源类型、书名与章节定位）。',
    inputSchema: knowledgeInputSchema,
    execute: async ({ query, subject, kind }): Promise<KnowledgeToolOutput> => {
      try {
        let results = await searchKnowledgeChunks(userId, query, subject, kind)
        // 过滤维度落空时逐级回退查全部:模型可能把学科/类型归错,服务端自愈重查
        if (!results.length && kind) results = await searchKnowledgeChunks(userId, query, subject)
        if (!results.length && subject) results = await searchKnowledgeChunks(userId, query)

        return {
          query,
          results,
          note: buildResultNote(results, query),
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知检索错误'
        console.error('[knowledge-tool]', message)
        return {
          query,
          results: [],
          error: message,
          note: '课本检索暂时不可用。请按你自己的知识回答用户，不必提及检索失败细节。',
        }
      }
    },
  })
}

/** 按命中结果的类型组合生成使用提示(课本与资料的引用规则不同) */
function buildResultNote(results: KnowledgeHit[], query: string): string {
  if (!results.length) {
    return `课本与资料中均未找到与「${query}」直接相关的内容。请如实告知用户知识库里没有这部分（可建议上传对应教材），再按你自己的知识作答。`
  }
  const hasTextbook = results.some((r) => r.kind === 'textbook')
  const hasMaterial = results.some((r) => r.kind === 'material')
  if (hasTextbook && hasMaterial) {
    return '以上结果混合了课本与资料:「课本」条目是教材原文,引用时标注书名+章节,与你的知识冲突时以课本为准;「资料」条目是答题模板/提纲,作答套路可参考,事实性表述仍以课本为准。'
  }
  if (hasMaterial) {
    return '以上为用户资料(答题模板/提纲)内容:作答思路与套路可参考,引用时标注资料名;事实性表述仍应回到课本,不要把资料当作教材原文。'
  }
  return '请基于以上课本原文回答用户问题，引用时标注来源（书名+章节，如《数学 七年级 上册》§1.2.3）。课本原文与你的知识不一致时，以课本为准。'
}

/**
 * 课本检索共享核心:整串+分词(空格拆,最多4个) OR 粗筛(pg_trgm ILIKE,
 * 按命中词数降序截断,防通用词挤出专指词目标)→
 * 加权精排(标题6/整串4/标题词3/正文词1,同分按书内顺序)→top5。
 * subject/kind 为可选过滤(传了才过滤,调用方自行处理空结果回退)。
 * chat 工具(search_knowledge)与独立出题 API(/api/study/quiz)共用，
 * 保证两边的检索口径一致。
 */
export async function searchKnowledgeChunks(
  userId: string,
  query: string,
  subject?: string,
  kind?: string
): Promise<KnowledgeHit[]> {
  const keywords = query.split(/\s+/).filter(Boolean).slice(0, 4)
  // 粗筛按「命中词数」降序截断:通用词(如「答题模板」)命中面可远超 FETCH_LIMIT,
  // 无序截断会把专指词目标(命中少但精确)挤出候选集——检索规模一变就复发。
  const terms = [query, ...keywords].filter((t, i, arr) => arr.indexOf(t) === i)
  const esc = (t: string) => t.replace(/[\\%_]/g, (m) => `\\${m}`)
  const like = (t: string) => `%${esc(t)}%`
  const hitExpr = Prisma.join(
    terms.map((t) => Prisma.sql`(CASE WHEN c.content ILIKE ${like(t)} THEN 1 ELSE 0 END)`),
    ' + '
  )
  const rows = await prisma.$queryRaw<RawChunkRow[]>(Prisma.sql`
    SELECT c.content, c.heading, c.chapter, c.section, c."sortOrder",
           d.title AS "docTitle", d.kind
    FROM "KnowledgeChunk" c
    JOIN "KnowledgeDoc" d ON d.id = c."docId"
    WHERE c."userId" = ${userId}
    ${subject ? Prisma.sql`AND d.subject = ${subject}` : Prisma.empty}
    ${kind ? Prisma.sql`AND d.kind = ${kind}` : Prisma.empty}
    AND (${Prisma.join(terms.map((t) => Prisma.sql`c.content ILIKE ${like(t)}`), ' OR ')})
    ORDER BY (${hitExpr}) DESC, c."sortOrder" ASC
    LIMIT ${FETCH_LIMIT}
  `)

  // 精排:标题/整串命中权重高,词命中次之;同分按书内顺序
  const lower = (s: string) => s.toLowerCase()
  const q = lower(query)
  const scored = rows.map((r) => {
    const c = lower(r.content)
    const h = lower(r.heading)
    let score = 0
    if (h.includes(q)) score += 6
    if (c.includes(q)) score += 4
    for (const k of keywords) {
      if (h.includes(lower(k))) score += 3
      if (c.includes(lower(k))) score += 1
    }
    return { r, score }
  })
  scored.sort((a, b) => b.score - a.score || a.r.sortOrder - b.r.sortOrder)
  return scored.slice(0, RESULT_LIMIT).map(({ r }) => ({
    doc: r.docTitle,
    kind: r.kind,
    chapter: r.chapter,
    section: r.section,
    heading: r.heading,
    content: r.content.slice(0, HIT_CONTENT_LIMIT),
  }))
}

/** 用户名下是否存在知识切块(物理级注入闸门:没有课本则工具完全不挂载) */
export async function hasKnowledgeChunks(userId: string): Promise<boolean> {
  const row = await prisma.knowledgeChunk.findFirst({
    where: { userId },
    select: { id: true },
  })
  return !!row
}
