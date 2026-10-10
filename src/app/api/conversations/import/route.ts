import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getUserId } from '@/lib/api-auth'
import { prisma } from '@/lib/db'
import { denyIfEphemeral } from '@/lib/ephemeral'
import { monitor } from '@/lib/monitor'
import {
  MAX_CONVERSATIONS_PER_IMPORT,
  importConversation,
  parseBundleInput,
  type ImportReport,
} from '@/lib/conversation-portable'

/**
 * POST /api/conversations/import
 * { bundle: <导出的 .aichat.json 内容>, preview?: boolean }
 *
 * 导入内核:归属一律覆写为当前登录者(包里的 userId 一概不认),
 * 会话/消息沿用包内 cuid 做天然幂等 —— 重复导入只会命中「已存在」而不会翻倍。
 *
 * preview=true 只查不改:把「会新建几条 / 几条已存在 / 几条是别人的」先摊给用户看,
 * 用户点头之后再不带 preview 重发一次。搬运是写库动作,先看后写比写完再撤回便宜。
 *
 * 鉴权双通道(lib/api-auth):cookie 会话(设置页导入)与
 * Authorization: Bearer sk- 令牌(本地实例「一键推送线上」,令牌在目标实例的
 * 设置→API 令牌 生成,绑定真实账户,全程不碰密码)。Bearer 通道不查 cookie,
 * 也就不存在访客态;临时模式 403 只对 cookie 通道生效,与 todos 端点同口径。
 *
 * 逐条独立事务:一条坏包不该把同批其余会话一起拖失败,
 * 但也不静默吞掉 —— 每条的去向都在 reports 里点名。
 */
export async function POST(req: Request) {
  const hasBearer = /^Bearer\s+/i.test(req.headers.get('authorization') ?? '')
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json(
      { error: hasBearer ? '令牌无效或已被撤销，请在目标实例重新生成' : '登录已失效，请重新登录后再试' },
      { status: 401 }
    )
  }
  if (!hasBearer) {
    const session = await auth()
    const denied = denyIfEphemeral(session)
    if (denied) return denied
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '请求参数不正确' }, { status: 400 })
  }

  const parsed = parseBundleInput((body as { bundle?: unknown }).bundle ?? body)
  if (parsed.conversations.length === 0) {
    return NextResponse.json(
      { error: parsed.errors?.[0] ?? '这个包里没有可导入的对话' },
      { status: 400 }
    )
  }
  if (parsed.conversations.length > MAX_CONVERSATIONS_PER_IMPORT) {
    return NextResponse.json(
      { error: `单次最多导入 ${MAX_CONVERSATIONS_PER_IMPORT} 条对话，请分批操作` },
      { status: 400 }
    )
  }

  const preview = (body as { preview?: unknown }).preview === true

  // 预演:一次性把所有同 id 会话捞出来分类,不写库
  if (preview) {
    const ids = parsed.conversations.map((c) => c.id)
    const existing = await prisma.conversation.findMany({
      where: { id: { in: ids } },
      select: { id: true, userId: true },
    })
    const ownerById = new Map(existing.map((row) => [row.id, row.userId]))

    const reports: ImportReport[] = parsed.conversations.map((c) => {
      const owner = ownerById.get(c.id)
      if (owner && owner !== userId) {
        return {
          outcome: 'foreign',
          id: c.id,
          title: c.title,
          reason: '这条记录已属于另一个账号，会被拒绝',
        }
      }
      if (owner) {
        return {
          outcome: 'duplicate',
          id: c.id,
          title: c.title,
          reason: '本站已有同一条对话，会被跳过',
        }
      }
      return {
        outcome: 'pending',
        id: c.id,
        title: c.title,
        messages: c.messageCount,
        strippedAttachments: c.attachmentCount,
      }
    })

    return NextResponse.json({
      preview: true,
      reports,
      parsed: parsed.conversations.length,
      skippedInvalid: parsed.errors.length,
      errors: parsed.errors,
    })
  }

  const reports: ImportReport[] = []
  for (const conversation of parsed.conversations) {
    try {
      reports.push(await importConversation(conversation, userId))
    } catch (err) {
      monitor('conversation_import_error', {
        userId,
        conversationId: conversation.id,
        message: err instanceof Error ? err.message : String(err),
      })
      reports.push({
        outcome: 'invalid',
        id: conversation.id,
        title: conversation.title,
        reason: '写入失败，已跳过这一条',
      })
    }
  }

  const counts = reports.reduce(
    (acc, r) => {
      acc[r.outcome] = (acc[r.outcome] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  monitor('conversations_import', {
    userId,
    parsed: parsed.conversations.length,
    created: counts.created ?? 0,
    duplicate: counts.duplicate ?? 0,
    foreign: counts.foreign ?? 0,
    invalid: counts.invalid ?? 0,
    invalidFromParse: parsed.errors.length,
  })

  return NextResponse.json({
    preview: false,
    reports,
    created: counts.created ?? 0,
    duplicate: counts.duplicate ?? 0,
    foreign: counts.foreign ?? 0,
    invalid: counts.invalid ?? 0,
    skippedInvalid: parsed.errors.length,
    errors: parsed.errors,
  })
}
