import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { estimateMessagesTokens } from "@/lib/context-compression"

/**
 * GET /api/conversations/[id]/context - 上下文用量面板数据
 *
 * 返回与 context-compression 同口径的 token 估算值 + assistant 真实 usage 合计,
 * 前端配合模型 contextWindow 计算占用百分比。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = params

  // Verify the conversation belongs to the user
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  })
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: id, archived: false, role: { in: ["user", "assistant"] } },
    select: { role: true, content: true, promptTokens: true, completionTokens: true },
  })

  // 与压缩触发判断同口径的粗估(中文×1.6 / 英文按词×1.3)
  const estimatedTokens = estimateMessagesTokens(
    messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
  )
  // assistant 消息落库的真实 usage 合计(仅部分模型/轮次有值,作为参考下限)
  const realTokens = messages.reduce(
    (sum, m) => sum + (m.promptTokens ?? 0) + (m.completionTokens ?? 0),
    0
  )

  const lastSummary = await prisma.conversationSummary.findFirst({
    where: { conversationId: id },
    orderBy: { createdAt: "desc" },
    select: { coveredMessages: true, createdAt: true, content: true },
  })

  return NextResponse.json({
    estimatedTokens,
    realTokens,
    messageCount: messages.length,
    lastSummary: lastSummary
      ? {
          coveredMessages: lastSummary.coveredMessages,
          createdAt: lastSummary.createdAt,
          preview: lastSummary.content.slice(0, 200),
        }
      : null,
  })
}
