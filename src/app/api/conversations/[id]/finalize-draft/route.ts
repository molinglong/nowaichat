import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * POST /api/conversations/[id]/finalize-draft
 *
 * A 流式恢复: 把该会话残留的 streaming 草稿行定格为普通消息。
 * 用于客户端在"轮询续显"期间主动停止生成——此时没有活动流可 abort,
 * 改为请求服务端置 streaming=false,让前端轮询立即定格。
 * 内容保留最新快照;服务端 onFinish 稍后仍会以最终内容覆盖(不依赖此标志)。
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = params

  // 归属校验:草稿行只允许在本人会话内定格
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  })
  if (!conversation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const result = await prisma.message.updateMany({
    where: { conversationId: id, streaming: true },
    data: { streaming: false },
  })

  return NextResponse.json({ ok: true, finalized: result.count })
}
