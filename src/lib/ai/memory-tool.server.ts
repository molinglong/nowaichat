import { tool } from "ai"
import { prisma } from "@/lib/db"
import { memoryInputSchema } from "@/lib/ai/memory-tool"

/**
 * add_memory 工具工厂（服务端专用，依赖 prisma；勿从客户端组件 import）。
 * 常量与 schema 在 memory-tool.ts（isomorphic），拆分原因见该文件头注释。
 */
export function createMemoryTool(userId: string) {
  return tool({
    description:
      "向用户长期记忆中添加条目。当用户明确要求你记住某件事（\"帮我记住…\"\"记一下…\"\"添加一条记忆\"）时调用；" +
      "每次 1-3 条，内容精炼为独立的陈述句。临时信息（验证码、一次性数据、当前时间天气）不要保存。" +
      "返回的 duplicates 表示已有相同或相似记忆，需如实告知用户。",
    inputSchema: memoryInputSchema,
    execute: async ({ memories }) => {
      const existing = await prisma.memory.findMany({
        where: { userId },
        select: { content: true },
      })

      const saved: string[] = []
      const duplicates: string[] = []
      const rejected: string[] = []

      for (const m of memories) {
        const content = m.content.trim()
        if (content.length < 4 || content.length > 200) {
          rejected.push(content)
          continue
        }
        // 与已有记忆、以及本轮已保存内容做互相包含去重(同手动添加规范)
        const isDup =
          existing.some((e) => e.content.includes(content) || content.includes(e.content)) ||
          saved.some((s) => s.includes(content) || content.includes(s))
        if (isDup) {
          duplicates.push(content)
          continue
        }
        await prisma.memory.create({
          data: {
            userId,
            category: m.category ?? "manual",
            content,
            source: "manual",
          },
        })
        saved.push(content)
        existing.push({ content })
      }

      return { ok: saved.length > 0, saved, duplicates, rejected }
    },
  })
}
