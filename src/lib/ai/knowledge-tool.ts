/**
 * 课本知识库检索工具（search_knowledge）—— 纯常量模块（isomorphic，客户端可安全 import）
 *
 * ⚠ 本文件禁止 import prisma/ai 等服务端依赖（ToolCallCard 只需要
 * KNOWLEDGE_TOOL_NAME，混入会连 pg 一起打进客户端 bundle 报 fs 错误）；
 * 工具工厂与检索闸门在 knowledge-tool-server.ts。
 *
 * 与 web_search 同一协议：有 execute，服务端直接查库，AI SDK 拿到结果自动续写。
 * - 数据源：KnowledgeChunk（当前用户名下按章节切块的课本文本，content 走
 *   pg_trgm GIN 索引，contains insensitive 在 PostgreSQL 生成 ILIKE 可命中索引）
 * - 触发：模型按工具 description + chat route 能力段自主决定调用（无 if-else）
 * - 半绑定：面具的 subject 学科倾向仅作为能力段默认过滤建议，不锁死——
 *   入参 subject 仍由模型按实际问题决定。
 */
import { z } from 'zod'

export const KNOWLEDGE_TOOL_NAME = 'search_knowledge'

export const knowledgeInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(60)
    .describe("检索关键词，2-6 个词，如「相反数 定义」「乘法法则」「数轴」"),
  subject: z
    .string()
    .max(20)
    .optional()
    .describe(
      '学科过滤(math/chinese/english/physics/chemistry/biology/other)，不传则查全部学科'
    ),
})

export type KnowledgeToolInput = z.infer<typeof knowledgeInputSchema>

/** 学科中文名(能力段与降级文案用) */
export const KNOWLEDGE_SUBJECT_LABELS: Record<string, string> = {
  math: '数学',
  chinese: '语文',
  english: '英语',
  physics: '物理',
  chemistry: '化学',
  biology: '生物',
  other: '其他',
}

export interface KnowledgeHit {
  doc: string
  chapter: string | null
  section: string | null
  heading: string
  content: string
}

export interface KnowledgeToolOutput {
  query: string
  results: KnowledgeHit[]
  note: string
  error?: string
}
