import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { ephemeralScope } from "@/lib/ephemeral"

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = params
  const { searchParams } = new URL(req.url)
  const cursor = searchParams.get("cursor") ?? undefined
  const model = searchParams.get("model") ?? undefined
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 100)

  // Verify the conversation belongs to the user
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id, ...ephemeralScope(session) },
    select: { id: true },
  })

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const messages = await prisma.message.findMany({
    // C 分支轻量版: 归档消息不在正常列表中展示(仅回看端点可见)
    where: { conversationId: id, archived: false, ...(model ? { model } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit + 1, // fetch one extra to determine if there's a next page
    ...(cursor
      ? {
          skip: 1, // skip the cursor itself
          cursor: { id: cursor },
        }
      : {}),
    select: {
      id: true,
      role: true,
      content: true,
      attachments: true,
      reasoning: true,
      metadata: true,
      model: true,
      streaming: true,
      createdAt: true,
    },
  })

  const hasMore = messages.length > limit
  const page = hasMore ? messages.slice(0, limit) : messages
  const nextCursor = hasMore ? page[page.length - 1]?.id : null

  return NextResponse.json({
    messages: page,
    nextCursor,
  })
}

/**
 * Archive a message and all messages after it in the conversation.
 * Used when a user edits a message — the old message and its
 * subsequent responses are archived (C 分支轻量版) before the new
 * message is sent, so the old branch stays retrievable via the
 * archived endpoint (?rootId=<messageId>) instead of being lost.
 *
 * Query: ?messageId=<id>
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = params
  const { searchParams } = new URL(req.url)
  const messageId = searchParams.get("messageId")

  if (!messageId) {
    return NextResponse.json(
      { error: "messageId query parameter is required" },
      { status: 400 }
    )
  }

  // Verify the conversation belongs to the user
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id, ...ephemeralScope(session) },
    select: { id: true },
  })

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // Find the target message to get its createdAt timestamp
  let targetMessage = await prisma.message.findFirst({
    where: { id: messageId, conversationId: id },
    select: { id: true, createdAt: true },
  })

  if (!targetMessage) {
    // C 分支轻量版回退: 刚发送的消息在客户端持有 AI SDK 本地临时 id(与服务端 cuid 不同),
    // 直接按 id 查必 404。客户端会附带旧文本,按 内容+角色+最近10分钟 定位真实行。
    // 10 分钟窗口将误匹配风险压到几乎为零(临时 id 消息都是刚发送的)。
    const content = searchParams.get("content")
    if (content) {
      targetMessage = await prisma.message.findFirst({
        where: {
          conversationId: id,
          role: "user",
          content,
          createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      })
    }
  }

  if (!targetMessage) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 })
  }

  // C 分支轻量版: 归档代替物理删除,附件文件一并保留(旧版本图片不裂)。
  // archivedRoot 记被编辑消息的**真实数据库 id**(客户端传来的可能是本地临时 id),
  // 回看端点按它拉取旧版本链;返回 archivedRootId 供客户端作为新消息的 editedFrom。
  await prisma.message.updateMany({
    where: {
      conversationId: id,
      createdAt: { gte: targetMessage.createdAt },
    },
    data: { archived: true, archivedRoot: targetMessage.id },
  })

  return NextResponse.json({
    success: true,
    archived: true,
    archivedRootId: targetMessage.id,
  })
}
