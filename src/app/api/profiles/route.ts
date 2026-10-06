import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { isEphemeralSession } from '@/lib/ephemeral'
import {
  deriveStage,
  isIdentity,
  profileRefreshDue,
} from '@/lib/profile/academic'
import { DISPLAY_NAME_MAX, sanitizeProfileText } from '@/lib/profile/sanitize'
import {
  GENERAL_DOMAIN,
  GENERAL_FIELDS,
  normalizeGeneralFields,
  type GeneralFields,
} from '@/lib/profile/general'
import { loadGeneralProfile } from '@/lib/profile/load'

/**
 * 通用档案（domain='general'）读写口。
 * GET    档案 + 学年推算 + 到期判定（推算只给建议，回写必须走 confirm）
 * PUT    保存档位字段 / 注入开关 / 称呼（档位外取值直接 400，不静默固化）
 * POST   { action: 'confirm', stage? } 用户确认一次档案（换学年三选卡的「更新」）
 * DELETE 清空档案行（称呼是用户中心自己的字段，不随之清除）
 *
 * 临时模式（访客密码登录）四道动词全部 403：档案是本人隐私，借号场景不读也不写。
 */

function unauthorized() {
  return NextResponse.json({ error: '登录已失效，请重新登录后再试' }, { status: 401 })
}

function ephemeralBlocked() {
  return NextResponse.json({ error: '临时模式不提供个人档案' }, { status: 403 })
}

/** 返回 NextResponse 表示被拦（401/403），返回字符串表示放行的 userId */
async function guard(): Promise<NextResponse | string> {
  const session = await auth()
  if (!session?.user?.id) return unauthorized()
  if (isEphemeralSession(session)) return ephemeralBlocked()
  return session.user.id
}

function sameFields(a: GeneralFields, b: GeneralFields): boolean {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every((k) => a[k as keyof GeneralFields] === b[k as keyof GeneralFields])
}

/** GET /api/profiles */
export async function GET() {
  const guarded = await guard()
  if (guarded instanceof NextResponse) return guarded
  const userId = guarded

  const profile = await loadGeneralProfile(userId)
  const now = new Date()
  const identity = isIdentity(profile.fields.identity) ? profile.fields.identity : null

  // 只有学生/教师有「该升年级」的问题，上班族/自由职业/其他不推算
  const derived =
    identity && (identity === 'student' || identity === 'teacher')
      ? deriveStage(profile.fields.stage ?? null, profile.lastConfirmedAt, now)
      : null

  return NextResponse.json({
    profile,
    derived,
    refresh: profileRefreshDue(identity, profile.lastConfirmedAt, now),
    fields: GENERAL_FIELDS,
  })
}

/** PUT /api/profiles —— Body: { fields?, enabled?, nickname? }（undefined=不动，null/空串=清除） */
export async function PUT(req: Request) {
  const guarded = await guard()
  if (guarded instanceof NextResponse) return guarded
  const userId = guarded

  const body = (await req.json().catch(() => null)) as {
    fields?: unknown
    enabled?: unknown
    nickname?: unknown
  } | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '请求体不是合法的 JSON 对象' }, { status: 400 })
  }

  const current = await loadGeneralProfile(userId)

  if (body.fields !== undefined && (!body.fields || typeof body.fields !== 'object')) {
    return NextResponse.json({ error: 'fields 必须是对象' }, { status: 400 })
  }
  const incoming = normalizeGeneralFields(body.fields ?? {})
  if (incoming.rejected.length) {
    const labels = incoming.rejected
      .map((id) => GENERAL_FIELDS.find((f) => f.id === id)?.label ?? id)
      .join('、')
    return NextResponse.json({ error: `${labels}的取值不在档位内` }, { status: 400 })
  }

  const merged: GeneralFields = { ...current.fields }
  if (body.fields !== undefined) {
    const raw = body.fields as Record<string, unknown>
    for (const def of GENERAL_FIELDS) {
      if (raw[def.id] === undefined) continue
      if (raw[def.id] === null || raw[def.id] === '') delete merged[def.id]
      else merged[def.id] = incoming.fields[def.id]!
    }
  }

  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled 必须是布尔值' }, { status: 400 })
  }
  const enabled = body.enabled ?? current.enabled

  if (body.nickname !== undefined && typeof body.nickname !== 'string') {
    return NextResponse.json({ error: 'nickname 必须是字符串' }, { status: 400 })
  }
  const nickname =
    body.nickname === undefined ? undefined : sanitizeProfileText(body.nickname, DISPLAY_NAME_MAX)

  // 字段内容变化才算一次表态（只翻开关不重置提醒节奏）
  const contentChanged = !sameFields(current.fields, merged)
  const existing = await prisma.userDomainProfile.findUnique({
    where: { userId_domain: { userId: userId, domain: GENERAL_DOMAIN } },
  })

  if (nickname !== undefined) {
    await prisma.user.update({
      where: { id: userId },
      data: { nickname: nickname || null },
    })
  }

  const data = {
    fields: merged as unknown as Record<string, string>,
    enabled,
    ...(contentChanged || !existing ? { lastConfirmedAt: new Date() } : {}),
  }
  if (existing) {
    await prisma.userDomainProfile.update({ where: { id: existing.id }, data })
  } else {
    await prisma.userDomainProfile.create({
      data: { userId: userId, domain: GENERAL_DOMAIN, ...data },
    })
  }

  return NextResponse.json(await loadGeneralProfile(userId))
}

/** POST /api/profiles —— { action: 'confirm', stage? }：把推算值转成确认值 */
export async function POST(req: Request) {
  const guarded = await guard()
  if (guarded instanceof NextResponse) return guarded
  const userId = guarded

  const body = (await req.json().catch(() => null)) as {
    action?: unknown
    stage?: unknown
  } | null
  if (!body || body.action !== 'confirm') {
    return NextResponse.json({ error: '不支持的操作' }, { status: 400 })
  }

  const current = await loadGeneralProfile(userId)
  const merged: GeneralFields = { ...current.fields }
  if (typeof body.stage === 'string' && body.stage.trim()) {
    const checked = normalizeGeneralFields({ stage: body.stage.trim() })
    if (checked.rejected.length) {
      return NextResponse.json({ error: '学段取值不在档位内' }, { status: 400 })
    }
    merged.stage = checked.fields.stage!
  }

  const existing = await prisma.userDomainProfile.findUnique({
    where: { userId_domain: { userId: userId, domain: GENERAL_DOMAIN } },
  })
  const data = {
    fields: merged as unknown as Record<string, string>,
    lastConfirmedAt: new Date(),
  }
  if (existing) {
    await prisma.userDomainProfile.update({ where: { id: existing.id }, data })
  } else {
    await prisma.userDomainProfile.create({
      data: { userId: userId, domain: GENERAL_DOMAIN, ...data },
    })
  }

  return NextResponse.json(await loadGeneralProfile(userId))
}

/** DELETE /api/profiles —— 清空通用档案行 */
export async function DELETE() {
  const guarded = await guard()
  if (guarded instanceof NextResponse) return guarded
  const userId = guarded

  await prisma.userDomainProfile.deleteMany({
    where: { userId: userId, domain: GENERAL_DOMAIN },
  })
  return NextResponse.json(await loadGeneralProfile(userId))
}
