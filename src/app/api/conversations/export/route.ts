import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { ephemeralScope } from '@/lib/ephemeral'
import { monitor } from '@/lib/monitor'
import { buildBundle, type ConversationExportRows } from '@/lib/conversation-portable'

/**
 * POST /api/conversations/export
 * { ids: string[] } 或 { all: true }
 *
 * 导出会话整包(.aichat.json),供另一套实例(本地 dev ↔ 线上)导入。
 * 单条右键导出与批量勾选共用这一个端点 —— 差别只是 ids 长度。
 *
 * 口径与 GET /api/conversations 一致:临时会话只在临时模式(或 ?scope=ephemeral)下可见,
 * 不把隔离区的东西混进正常包。
 * 不归属当前用户的 id 静默跳过并在响应里回报 skipped,理由同 batch-delete:
 * 不用 404 泄露「这个 id 存在但不属于你」。
 *
 * 归档消息(C 分支轻量版留下的旧版本)一并带上并保留 archived 标志 ——
 * 少了它们,换实例之后「回看旧版本」会成空洞。
 */

/** 单次请求的会话条数上限:超出应分批,免得一个响应把内存与序列化时间拖爆 */
const MAX_CONVERSATIONS_PER_EXPORT = 200

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: '登录已失效，请重新登录后再试' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '请求参数不正确' }, { status: 400 })
  }

  const exportAll = body.all === true
  const scopeParam = String((body as { scope?: unknown }).scope ?? '')
    .trim()
    .toLowerCase()

  const ephemeral = ephemeralScope(session).isEphemeral
  const listEphemeral = ephemeral || scopeParam === 'ephemeral'

  let ids: string[] = []
  if (exportAll) {
    const rows = await prisma.conversation.findMany({
      where: { userId: session.user.id, isEphemeral: listEphemeral },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
      take: MAX_CONVERSATIONS_PER_EXPORT,
    })
    ids = rows.map((r) => r.id)
  } else {
    if (!Array.isArray(body.ids)) {
      return NextResponse.json({ error: '没有要导出的对话' }, { status: 400 })
    }
    ids = Array.from(
      new Set(
        (body.ids as unknown[]).filter(
          (id): id is string => typeof id === 'string' && id.length > 0
        )
      )
    )
  }

  if (ids.length === 0) {
    return NextResponse.json({ error: '没有可导出的对话' }, { status: 404 })
  }
  if (ids.length > MAX_CONVERSATIONS_PER_EXPORT) {
    return NextResponse.json(
      { error: `单次最多导出 ${MAX_CONVERSATIONS_PER_EXPORT} 条对话，请分批操作` },
      { status: 400 }
    )
  }

  const owned = await prisma.conversation.findMany({
    where: {
      id: { in: ids },
      userId: session.user.id,
      isEphemeral: listEphemeral,
    },
    select: {
      id: true,
      title: true,
      model: true,
      mode: true,
      compareModels: true,
      styleOffset: true,
      stylePreset: true,
      replyLength: true,
      maskId: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          role: true,
          content: true,
          reasoning: true,
          attachments: true,
          metadata: true,
          model: true,
          groupId: true,
          promptTokens: true,
          completionTokens: true,
          archived: true,
          archivedRoot: true,
          createdAt: true,
        },
      },
      summaries: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          rangeStart: true,
          rangeEnd: true,
          content: true,
          modelId: true,
          coveredMessages: true,
          createdAt: true,
        },
      },
      compareVotes: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, groupId: true, votedModel: true, createdAt: true },
      },
    },
  })

  const bundle = buildBundle(owned as ConversationExportRows[])

  monitor('conversations_export', {
    userId: session.user.id,
    requested: ids.length,
    exported: owned.length,
    skipped: ids.length - owned.length,
    all: exportAll,
    scope: listEphemeral ? 'ephemeral' : 'normal',
  })

  return NextResponse.json({
    bundle,
    exported: owned.length,
    skipped: ids.length - owned.length,
    // 用户在数"为什么少了两条":列表里有但本模式取不到时,这条提示是唯一的解释出口
    truncated: exportAll ? ids.length === MAX_CONVERSATIONS_PER_EXPORT : false,
  })
}
