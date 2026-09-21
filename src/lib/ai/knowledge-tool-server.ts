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

/**
 * 创建课本知识库检索工具。
 * @param userId 检索范围严格限定当前用户的切块(多用户数据主权)
 * @param preferredSubject 面具学科倾向(半绑定),仅写入能力段建议,不影响 execute 行为
 */
export function createKnowledgeTool(userId: string, preferredSubject?: string) {
  void preferredSubject // 半绑定作用于能力段文案;execute 层不过滤,保留参数位便于后续收紧
  return tool({
    description:
      '课本知识库检索工具。当需要引用教材原文、解释课本概念/公式/定理、或用户明确要求翻书时使用。输入检索关键词，返回课本中相关章节的原文片段（含书名与章节定位）。',
    inputSchema: knowledgeInputSchema,
    execute: async ({ query, subject }): Promise<KnowledgeToolOutput> => {
      try {
        let results = await searchKnowledgeChunks(userId, query, subject)
        // 学科过滤空结果时回退查全部:模型可能把问题学科归错(如政治→other),服务端自愈重查
        if (!results.length && subject) {
          results = await searchKnowledgeChunks(userId, query)
        }

        return {
          query,
          results,
          note: results.length
            ? '请基于以上课本原文回答用户问题，引用时标注来源（书名+章节，如《数学 七年级 上册》§1.2.3）。课本原文与你的知识不一致时，以课本为准。'
            : `课本中未找到与「${query}」直接相关的内容。请如实告知用户课本里没有这部分（可建议上传对应教材），再按你自己的知识作答。`,
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

/**
 * 课本检索共享核心:整串+分词(空格拆,最多4个) OR 粗筛(pg_trgm ILIKE)→
 * 加权精排(标题6/整串4/标题词3/正文词1,同分按书内顺序)→top5。
 * chat 工具(search_knowledge)与独立出题 API(/api/study/quiz)共用，
 * 保证两边的检索口径一致。
 */
export async function searchKnowledgeChunks(
  userId: string,
  query: string,
  subject?: string
): Promise<KnowledgeHit[]> {
  const keywords = query.split(/\s+/).filter(Boolean).slice(0, 4)
  const rows = await prisma.knowledgeChunk.findMany({
    where: {
      userId,
      ...(subject ? { doc: { subject } } : {}),
      OR: [
        { content: { contains: query, mode: 'insensitive' } },
        ...keywords.map((k) => ({
          content: { contains: k, mode: 'insensitive' as const },
        })),
      ],
    },
    select: {
      content: true,
      heading: true,
      chapter: true,
      section: true,
      sortOrder: true,
      doc: { select: { title: true, subject: true } },
    },
    take: FETCH_LIMIT,
  })

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
    doc: r.doc.title,
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
