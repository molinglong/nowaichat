import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { deleteReferencedFiles } from "@/lib/uploads"

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
    where: { id, userId: session.user.id },
    select: { id: true },
  })

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: id, ...(model ? { model } : {}) },
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
      model: true,
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
 * Delete a message and all messages after it in the conversation.
 * Used when a user edits a message — the old message and its
 * subsequent responses are removed before the new message is sent.
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
    where: { id, userId: session.user.id },
    select: { id: true },
  })

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // Find the target message to get its createdAt timestamp
  const targetMessage = await prisma.message.findFirst({
    where: { id: messageId, conversationId: id },
    select: { createdAt: true },
  })

  if (!targetMessage) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 })
  }

  // 删除前收集将删除消息引用的附件文件(编辑消息时级联清理)
  const doomed = await prisma.message.findMany({
    where: {
      conversationId: id,
      createdAt: { gte: targetMessage.createdAt },
      attachments: { not: null },
    },
    select: { attachments: true },
  })

  // Delete the target message and all messages after it
  await prisma.message.deleteMany({
    where: {
      conversationId: id,
      createdAt: { gte: targetMessage.createdAt },
    },
  })

  // 库删除完成后清理磁盘文件
  for (const m of doomed) {
    await deleteReferencedFiles(m.attachments)
  }

  return NextResponse.json({ success: true })
}
