import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { quotaDayKeyOf, getModelTotalConsumed } from '@/lib/quota'
import { guardAdmin, maskSecret } from '@/lib/admin'
import { providers, getAllModels } from '@/lib/ai/registry'

/**
 * GET /api/quota/admin —— 管理员专属:公共池状态 + 各用户用量聚合 + 公共模型与
 * 服务端 Key、激活码的管理数据。
 *
 * 验权不信任 JWT 里的 role(旧 token 可能没有,也可能过期失真),一律按 DB 实时值
 * User.role === 'admin';临时模式由 middleware 前置拦截,DB 验权作第二道防线。
 *
 * 返回:池行原样 + users[](按累计用量降序) + publicModels[](含禁用行) +
 * poolKeys[](掩码,绝不回明文) + codes[](激活码,含兑换人) + regcodes[](注册码,含注册人):
 *   - todayTokens:北京时间今天的 dayKey 聚合,只算 chat 真实消耗
 *     (redeem/bonus_spend 是激活码余额收支,算进来会虚报用量)
 *   - totalTokens / requests:同口径全时段累计与请求数
 */

export async function GET() {
  const guarded = await guardAdmin()
  if (guarded instanceof NextResponse) return guarded

  const dayKey = quotaDayKeyOf()

  const [pool, todayRows, totalRows, publicModels, poolKeys, codes, regcodes, modelUsage] = await Promise.all([
    prisma.quotaPool.findUnique({ where: { id: 'global' } }),
    prisma.quotaLedger.groupBy({
      by: ['userId'],
      where: { dayKey, kind: 'chat' },
      _sum: { tokens: true },
    }),
    prisma.quotaLedger.groupBy({
      by: ['userId'],
      where: { kind: 'chat' },
      _sum: { tokens: true },
      _count: { _all: true },
    }),
    prisma.publicPoolModel.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.publicPoolKey.findMany({ orderBy: { provider: 'asc' } }),
    prisma.quotaRedeemCode.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.registerCode.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    // 各模型全站累计消耗(门面预算 capTokens 的判定口径,展示用同一真相源)
    getModelTotalConsumed().catch(() => new Map<string, number>()),
  ])

  const todayMap = new Map(todayRows.map((r) => [r.userId, r._sum.tokens ?? 0]))
  const totalMap = new Map(
    totalRows.map((r) => [r.userId, { tokens: r._sum.tokens ?? 0, requests: r._count._all }]),
  )
  const userIds = Array.from(new Set(Array.from(todayMap.keys()).concat(Array.from(totalMap.keys()))))
  const redeemerIds = Array.from(new Set(
    [...codes.map((c) => c.redeemedBy), ...regcodes.map((c) => c.usedBy)].filter((v): v is string => !!v)
  ))

  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, nickname: true, role: true },
      })
    : []
  const redeemers = redeemerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: redeemerIds } },
        select: { id: true, nickname: true, name: true, email: true },
      })
    : []
  const redeemerMap = new Map(redeemers.map((u) => [u.id, u.nickname || u.name || u.email.split('@')[0]]))

  const rows = users
    .map((u) => ({
      userId: u.id,
      name: u.name,
      nickname: u.nickname,
      email: u.email,
      role: u.role,
      todayTokens: todayMap.get(u.id) ?? 0,
      totalTokens: totalMap.get(u.id)?.tokens ?? 0,
      requests: totalMap.get(u.id)?.requests ?? 0,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.todayTokens - a.todayTokens)

  return NextResponse.json({
    pool,
    dayKey,
    users: rows,
    publicModels: publicModels.map((m) => ({ ...m, usedTokens: modelUsage.get(m.id) ?? 0 })),
    codes: codes.map((c) => ({
      code: c.code,
      tokens: c.tokens,
      note: c.note,
      enabled: c.enabled,
      redeemedBy: c.redeemedBy,
      redeemedByName: c.redeemedBy ? redeemerMap.get(c.redeemedBy) ?? null : null,
      redeemedAt: c.redeemedAt,
      createdAt: c.createdAt,
    })),
    regcodes: regcodes.map((c) => ({
      code: c.code,
      note: c.note,
      enabled: c.enabled,
      usedBy: c.usedBy,
      usedByName: c.usedBy ? redeemerMap.get(c.usedBy) ?? null : null,
      usedAt: c.usedAt,
      createdAt: c.createdAt,
    })),
    poolKeys: poolKeys.map((k) => ({
      provider: k.provider,
      masked: maskSecret(k.apiKey),
      updatedAt: k.updatedAt,
    })),
    // 表单目录:新增门面模型时选服务商与上游模型用(静态注册表,免第二个接口)
    catalog: {
      providers: Object.values(providers).map((p) => ({ id: p.id, name: p.name })),
      builtinModels: getAllModels().map((m) => ({ id: m.id, name: m.name, provider: m.provider })),
    },
  })
}
