import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { denyIfEphemeral } from '@/lib/ephemeral'

/**
 * 临时聊天账户设置端点(仅正常模式可用,临时模式 403)。
 *
 * GET /api/user/ephemeral-settings
 *   → { hasGuestPassword, ephemeralMemoryInjection }
 *
 * PUT /api/user/ephemeral-settings
 *   body: { currentPassword, guestPassword?, ephemeralMemoryInjection? }
 *   - 修改访客密码/清除访客密码均须先验证主密码(currentPassword)
 *   - 仅切换 ephemeralMemoryInjection 不涉及入口凭据,无需主密码
 *   - guestPassword: 4-64 位;与主密码相同会被拒绝;null 表示清除(关闭访客入口)
 *   - 访客密码强度有意放宽(4 位起):临时模式内无敏感数据,
 *     防爆破由登录失败限速兜底,不强制高复杂度
 */

const GUEST_PASSWORD_MIN = 4
const GUEST_PASSWORD_MAX = 64

/** GET /api/user/ephemeral-settings */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const denied = denyIfEphemeral(session)
  if (denied) return denied

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { guestPasswordHash: true, ephemeralMemoryInjection: true },
  })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  return NextResponse.json({
    hasGuestPassword: !!user.guestPasswordHash,
    ephemeralMemoryInjection: user.ephemeralMemoryInjection,
  })
}

/** PUT /api/user/ephemeral-settings */
export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const denied = denyIfEphemeral(session)
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : ''
  const guestPassword = body?.guestPassword === null ? null
    : typeof body?.guestPassword === 'string' ? body.guestPassword : undefined
  const ephemeralMemoryInjection = typeof body?.ephemeralMemoryInjection === 'boolean'
    ? body.ephemeralMemoryInjection
    : undefined

  if (guestPassword === undefined && ephemeralMemoryInjection === undefined) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true, guestPasswordHash: true },
  })
  if (!user || !user.passwordHash) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // 主密码验证:访客密码是"开启第二入口"的高权重账户操作,必须本人确认;
  // 仅切换记忆注入开关时不涉及入口凭据,不要求主密码
  if (guestPassword !== undefined) {
    const mainPasswordOk = currentPassword
      ? await bcrypt.compare(currentPassword, user.passwordHash)
      : false
    if (!mainPasswordOk) {
      return NextResponse.json({ error: '主密码验证失败' }, { status: 403 })
    }
  }

  const data: { guestPasswordHash?: string | null; ephemeralMemoryInjection?: boolean } = {}

  if (ephemeralMemoryInjection !== undefined) {
    data.ephemeralMemoryInjection = ephemeralMemoryInjection
  }

  if (guestPassword !== undefined) {
    if (guestPassword === null) {
      // 清除访客密码 = 关闭临时登录入口
      data.guestPasswordHash = null
    } else {
      const pwd = guestPassword.trim()
      if (pwd.length < GUEST_PASSWORD_MIN || pwd.length > GUEST_PASSWORD_MAX) {
        return NextResponse.json(
          { error: `访客密码长度需在 ${GUEST_PASSWORD_MIN}-${GUEST_PASSWORD_MAX} 位之间` },
          { status: 400 }
        )
      }
      // 与主密码相同视为无效配置(两把钥匙必须可区分)
      if (await bcrypt.compare(pwd, user.passwordHash)) {
        return NextResponse.json({ error: '访客密码不能与主密码相同' }, { status: 400 })
      }
      data.guestPasswordHash = await bcrypt.hash(pwd, 10)
    }
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data,
  })

  return NextResponse.json({
    success: true,
    hasGuestPassword: data.guestPasswordHash === null
      ? false
      : data.guestPasswordHash !== undefined
        ? true
        : !!user.guestPasswordHash,
    ephemeralMemoryInjection: data.ephemeralMemoryInjection ?? undefined,
  })
}
