import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { ephemeralScope } from '@/lib/ephemeral'

/**
 * POST /api/conversations/[id]/compare-vote
 * Body: { modelId: string }
 *
 * E 对比模式投票: 给该泳道模型最新一轮回答投票。
 * 服务端按 modelId 反查该会话中该模型最新的 assistant 消息拿到 groupId,
 * 前端无需感知 groupId。每轮一票,重复投票 = 改票(upsert)。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = params
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id, ...ephemeralScope(session) },
    select: { id: true },
  })
  if (!conversation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const modelId = (body.modelId ?? '').toString()
  if (!modelId) {
    return NextResponse.json({ error: 'modelId is required' }, { status: 400 })
  }

  // 反查该模型在本会话的最新 assistant 消息,取其 groupId
  const latestAnswer = await prisma.message.findFirst({
    where: {
      conversationId: id,
      role: 'assistant',
      model: modelId,
      groupId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    select: { groupId: true },
  })
  if (!latestAnswer?.groupId) {
    return NextResponse.json({ error: '该模型暂无已完成的对比回答' }, { status: 400 })
  }

  const vote = await prisma.compareVote.upsert({
    where: {
      conversationId_groupId: { conversationId: id, groupId: latestAnswer.groupId },
    },
    create: {
      userId: session.user.id,
      conversationId: id,
      groupId: latestAnswer.groupId,
      votedModel: modelId,
    },
    update: { votedModel: modelId },
  })

  return NextResponse.json({ ok: true, groupId: vote.groupId, votedModel: vote.votedModel })
}
