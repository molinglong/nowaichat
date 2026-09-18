import { prisma } from "@/lib/db"
import type { Memory } from "@/generated/prisma/client"

/**
 * 记忆存储层：全部 Prisma 读写集中于此，
 * 上层（extractor / dedupe / API 路由）不直接触碰 prisma.memory
 */

/** 拉取用户全部记忆事实（id + content），供去重与矛盾替换判断使用 */
export async function listAllMemoryFacts(
  userId: string
): Promise<Pick<Memory, "id" | "content">[]> {
  return prisma.memory.findMany({
    where: { userId },
    select: { id: true, content: true },
  })
}

/** 拉取用户全部记忆正文，供提取时作为"已有记忆"上下文 */
export async function listAllMemoryContents(userId: string): Promise<string[]> {
  const rows = await prisma.memory.findMany({
    where: { userId },
    select: { content: true },
  })
  return rows.map((r) => r.content)
}

/** 写入一条自动提取的记忆 */
export async function createAutoMemory(
  userId: string,
  category: string,
  content: string
): Promise<Memory> {
  return prisma.memory.create({
    data: { userId, category, content, source: "auto" },
  })
}

/** 按主键批量删除（矛盾替换时移除被取代的旧记忆） */
export async function deleteMemoriesByIds(ids: string[]): Promise<number> {
  if (!ids.length) return 0
  const result = await prisma.memory.deleteMany({
    where: { id: { in: ids } },
  })
  return result.count
}
