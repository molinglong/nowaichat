import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { deleteUploadFile, parseAttachmentNames } from '@/lib/uploads'
import { isEphemeralSession } from '@/lib/ephemeral'
import { monitor } from '@/lib/monitor'

/**
 * POST /api/conversations/batch-delete
 * { ids: string[], scope?: 'ephemeral' }
 *
 * 一次请求删除多条会话:消息/摘要/投票随 Prisma 级联删除,附件磁盘文件在库删除后清理。
 * 归属校验用集合过滤而不是逐条循环 —— 不属于当前用户的 id 静默跳过并在响应里回报,
 * 既不用 404 泄露「这个 id 存在但不属于你」,也不会让一条越权 id 卡住整批。
 *
 * scope=ephemeral 只在正常模式下生效,与 GET /api/conversations 的隔离区查看口径一致
 * (设置→用户中心 的临时对话走的是这个隔离区)。
 */

/** 单次请求上限:超出的调用方应分批,避免一个请求把 fs 与 DB 拖到超时 */
const MAX_IDS_PER_REQUEST = 200

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: '登录已失效，请重新登录后再试' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || !Array.isArray(body.ids)) {
    return NextResponse.json({ error: '请求参数不正确' }, { status: 400 })
  }

  const ids: string[] = Array.from(
    new Set(
      (body.ids as unknown[]).filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      )
    )
  )
  if (ids.length === 0) {
    return NextResponse.json({ error: '没有要删除的对话' }, { status: 400 })
  }
  if (ids.length > MAX_IDS_PER_REQUEST) {
    return NextResponse.json(
      { error: `单次最多删除 ${MAX_IDS_PER_REQUEST} 条对话，请分批操作` },
      { status: 400 }
    )
  }

  const ephemeral = isEphemeralSession(session)
  const scope = String(body?.scope ?? '').trim().toLowerCase()
  const deleteEphemeral = ephemeral || scope === 'ephemeral'

  const owned = await prisma.conversation.findMany({
    where: { id: { in: ids }, userId: session.user.id, isEphemeral: deleteEphemeral },
    select: { id: true },
  })
  const ownedIds = owned.map((c) => c.id)
  const skipped = ids.length - ownedIds.length

  if (ownedIds.length === 0) {
    return NextResponse.json({ error: '内容不存在或已被删除' }, { status: 404 })
  }

  // 删除前收集附件文件名:消息会随会话级联删除,磁盘文件必须一并清理
  const messages = await prisma.message.findMany({
    where: { conversationId: { in: ownedIds }, attachments: { not: null } },
    select: { attachments: true },
  })
  // 同一文件可能被多条消息引用,去重后每个文件只删一次
  const fileNames = new Set<string>()
  for (const m of messages) {
    for (const name of parseAttachmentNames(m.attachments)) fileNames.add(name)
  }

  await prisma.conversation.deleteMany({ where: { id: { in: ownedIds } } })

  monitor('conversations_batch_delete', {
    userId: session.user.id,
    requested: ids.length,
    deleted: ownedIds.length,
    skipped,
    files: fileNames.size,
    scope: deleteEphemeral ? 'ephemeral' : 'normal',
  })

  for (const name of Array.from(fileNames)) {
    await deleteUploadFile(name)
  }

  return NextResponse.json({ success: true, deleted: ownedIds.length, skipped })
}
