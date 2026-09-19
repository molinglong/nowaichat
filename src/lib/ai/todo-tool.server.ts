import { tool } from "ai"
import { prisma } from "@/lib/db"
import { todoInputSchema, type TodoToolOutput } from "@/lib/ai/todo-tool"

/**
 * manage_todo 工具工厂（服务端专用，依赖 prisma；勿从客户端组件 import）。
 * 常量与 schema 在 todo-tool.ts（isomorphic），拆分原因见该文件头注释。
 *
 * 与 REST API（/api/todos）共用 Todo 表与校验口径（1-100 字），两边操作互通。
 * 模糊匹配（双向 includes）仅限同一用户名下的待办，命中多条时返回候选项
 * 交由模型向用户澄清，绝不擅自选择。
 */
export function createTodoTool(userId: string) {
  return tool({
    description:
      "管理用户的待办清单。用户要求添加待办/提醒（\"提醒我周五交作业\"）、标记完成（\"作业写完了\"）、" +
      "删除（\"把补牙那条删了\"）或查看待办时调用。添加支持自然语言时间（自动转截止时间）；" +
      "完成/删除按内容关键词模糊匹配，命中多条会返回候选项，需向用户确认。",
    inputSchema: todoInputSchema,
    execute: async ({ operation, items, match }): Promise<TodoToolOutput> => {
      if (operation === "add") {
        if (!items || items.length === 0) {
          return { ok: false, operation, reason: "invalid_input", message: "add 需要至少一条待办内容" }
        }
        const added: Array<{ content: string; dueAt?: string | null }> = []
        for (const item of items) {
          const content = item.content.trim()
          if (content.length < 1 || content.length > 100) continue
          const dueAt = item.dueAt ? parseDueDate(item.dueAt) : null
          await prisma.todo.create({
            data: { userId, content, dueAt, source: "ai" },
          })
          added.push({ content, dueAt: dueAt?.toISOString() ?? null })
        }
        return { ok: added.length > 0, operation, added }
      }

      if (operation === "list") {
        const todos = await prisma.todo.findMany({
          where: { userId },
          orderBy: [{ done: "asc" }, { createdAt: "desc" }],
          take: 30,
          select: { id: true, content: true, done: true, dueAt: true },
        })
        return {
          ok: true,
          operation,
          todos: todos.map((t) => ({
            id: t.id,
            content: t.content,
            done: t.done,
            dueAt: t.dueAt?.toISOString() ?? null,
          })),
        }
      }

      // complete / delete：按内容模糊匹配
      const keyword = (match ?? "").trim()
      if (!keyword) {
        return { ok: false, operation, reason: "invalid_input", message: "complete/delete 需要 match 关键词" }
      }
      const candidates = await prisma.todo.findMany({
        where: {
          userId,
          // complete 只匹配未完成；delete 可匹配已完成（清理残留）
          ...(operation === "complete" ? { done: false } : {}),
        },
        orderBy: { createdAt: "desc" },
      })
      const hits = candidates.filter(
        (t) => t.content.includes(keyword) || keyword.includes(t.content)
      )

      if (hits.length === 0) {
        return { ok: false, operation, reason: "not_found", message: `没有匹配「${keyword}」的待办` }
      }
      if (hits.length > 1) {
        return {
          ok: false,
          operation,
          reason: "ambiguous",
          candidates: hits.map((t) => t.content),
          message: `匹配到 ${hits.length} 条待办，请向用户确认是哪一条`,
        }
      }

      const hit = hits[0]
      if (operation === "complete") {
        await prisma.todo.update({
          where: { id: hit.id },
          data: { done: true, doneAt: new Date() },
        })
        return { ok: true, operation, completed: [hit.content] }
      }
      await prisma.todo.delete({ where: { id: hit.id } })
      return { ok: true, operation, deleted: [hit.content] }
    },
  })
}

/** ISO 时间字符串宽松解析：非法返回 null（工具不因时间解析失败而整体失败） */
function parseDueDate(iso: string): Date | null {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}
