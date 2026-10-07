import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { isEphemeralSession } from '@/lib/ephemeral'
import { redeemCode, getBonusRemaining } from '@/lib/quota'

/**
 * POST /api/quota/redeem —— 用户凭激活码兑换「附加余额」（跨天存续,基础日限
 * 烧完后自动扣,用完为止）。临时访客不能兑(转瞬即逝的账户兑了浪费):middleware
 * 已按前缀拦一道,这里 isEphemeral 再验一次。余额口径见 lib/quota.ts。
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: '登录已失效，请重新登录后再试' }, { status: 401 })
  }
  if (isEphemeralSession(session)) {
    return NextResponse.json({ error: '临时访客不能兑换激活码，请用正式账号登录' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const code = typeof body?.code === 'string' ? body.code : ''
  const result = await redeemCode(session.user.id, code)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  const bonusRemaining = await getBonusRemaining(session.user.id)
  return NextResponse.json({ ok: true, tokens: result.tokens, bonusRemaining })
}
