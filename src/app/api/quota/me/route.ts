import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { isEphemeralSession } from '@/lib/ephemeral'
import { quotaDayKeyOf, getBonusRemaining } from '@/lib/quota'

/**
 * GET /api/quota/me —— 当前用户今天的公共额度：已用 / 日限 / 剩余 / 附加余额。
 * 日限档位随会话形态：临时访客（访客密码登录）走池上的低档。管理员 unlimited=true、
 * dailyLimit=null（豁免个人日限，checkQuota 同口径），前端据此显示「日限不限」。
 * 聚合口径与 lib/quota.ts 的 checkQuota 完全一致：todayTokens 只算 chat 真实消耗
 * （redeem/bonus_spend 是激活码余额收支，混进来会虚报）；bonusRemaining 为激活码
 * 附加余额（跨天存续），日限触顶后自动续烧。池行不存在时 dailyLimit=null 且
 * unlimited=false，前端隐藏卡片。只返回本人数据；全站管理视图在 /api/quota/admin
 * （管理员专属 + middleware 拦临时模式）。
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: '登录已失效，请重新登录后再试' }, { status: 401 })
  }
  const ephemeral = isEphemeralSession(session)
  const dayKey = quotaDayKeyOf()

  const [pool, agg, bonus, user] = await Promise.all([
    prisma.quotaPool.findUnique({ where: { id: 'global' } }),
    prisma.quotaLedger.aggregate({
      where: { userId: session.user.id, dayKey, kind: 'chat' },
      _sum: { tokens: true },
    }),
    getBonusRemaining(session.user.id),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } }),
  ])

  const unlimited = user?.role === 'admin'
  const dailyLimit = unlimited || !pool
    ? null
    : ephemeral
      ? pool.ephemeralPerUserDailyTokens
      : pool.perUserDailyTokens
  const todayTokens = agg._sum.tokens ?? 0
  const bonusRemaining = Math.max(0, bonus)

  return NextResponse.json({
    dayKey,
    ephemeral,
    unlimited,
    todayTokens,
    dailyLimit,
    remaining: dailyLimit === null ? null : Math.max(0, dailyLimit - todayTokens) + bonusRemaining,
    bonusRemaining,
  })
}
