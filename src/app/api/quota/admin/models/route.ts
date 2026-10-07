import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { guardAdmin } from '@/lib/admin'
import { providers, getAllModels } from '@/lib/ai/registry'

/**
 * 公共池门面模型管理（管理员专属，/api/quota/admin 前缀已被 middleware 对临时模式拦截）。
 * POST   { name, provider, upstreamId, weight?, capTokens? }  新增（id 自动生成 pool-*，enabled=true）
 * PATCH  { id, enabled?, weight?, capTokens? }                启用/停用、改计费倍率、改全站累计预算（至少一项）
 * DELETE ?id=                                                 删除
 *
 * 列表不在此处：主 GET /api/quota/admin 已带 publicModels（含禁用行+usedTokens），前端一次取全。
 * 新增校验：name 1~24 字；provider 必须在内置 provider 注册表；upstreamId 必须是
 * 该 provider 的内置模型（能力读取时从上游继承，配错上游的门面会被直接丢弃）；
 * weight 为计费倍率（落账 tokens×weight），0.01~100，默认 1；
 * capTokens 为全站累计预算（Σchat 落账达到即停运+用户端隐藏），0=不限，默认 0。
 */

const NAME_MAX = 24
const WEIGHT_MIN = 0.01
const WEIGHT_MAX = 100
const CAP_MAX = 1_000_000_000

/** weight 归一化：空/缺省回退 fallback；非法返回 null 交给调用方报 400 */
function parseWeight(v: unknown, fallback: number): number | null {
  if (v === undefined || v === null || v === "") return fallback
  const n = typeof v === "number" ? v : parseFloat(String(v))
  if (!Number.isFinite(n) || n < WEIGHT_MIN || n > WEIGHT_MAX) return null
  return n
}

/** capTokens 归一化：空/缺省回退 fallback；须 0~10亿 整数（0=不限） */
function parseCap(v: unknown, fallback: number): number | null {
  if (v === undefined || v === null || v === "") return fallback
  const n = typeof v === "number" ? v : parseInt(String(v), 10)
  if (!Number.isInteger(n) || n < 0 || n > CAP_MAX) return null
  return n
}

export async function POST(req: NextRequest) {
  const guarded = await guardAdmin()
  if (guarded instanceof NextResponse) return guarded

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const provider = typeof body?.provider === 'string' ? body.provider.trim() : ''
  const upstreamId = typeof body?.upstreamId === 'string' ? body.upstreamId.trim() : ''

  if (!name || name.length > NAME_MAX) {
    return NextResponse.json({ error: `显示名需 1~${NAME_MAX} 个字` }, { status: 400 })
  }
  if (!providers[provider]) {
    return NextResponse.json({ error: '未知服务商' }, { status: 400 })
  }
  const upstream = getAllModels().find((m) => m.id === upstreamId && m.provider === provider)
  if (!upstream) {
    return NextResponse.json({ error: '上游模型不存在或不属于该服务商' }, { status: 400 })
  }
  const weight = parseWeight(body?.weight, 1)
  if (weight === null) {
    return NextResponse.json({ error: `倍率需在 ${WEIGHT_MIN}~${WEIGHT_MAX} 之间` }, { status: 400 })
  }
  const capTokens = parseCap(body?.capTokens, 0)
  if (capTokens === null) {
    return NextResponse.json({ error: '限额需为 0~10亿 的整数（0=不限）' }, { status: 400 })
  }

  const row = await prisma.publicPoolModel.create({
    data: {
      id: `pool-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name,
      provider,
      upstreamId,
      weight,
      capTokens,
    },
  })
  return NextResponse.json({ model: row })
}

export async function PATCH(req: NextRequest) {
  const guarded = await guardAdmin()
  if (guarded instanceof NextResponse) return guarded

  const body = await req.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) {
    return NextResponse.json({ error: '参数不完整' }, { status: 400 })
  }
  const hasEnabled = typeof body?.enabled === 'boolean'
  let weight: number | null = null
  if (body?.weight !== undefined) {
    weight = parseWeight(body.weight, NaN)
    if (weight === null) {
      return NextResponse.json({ error: `倍率需在 ${WEIGHT_MIN}~${WEIGHT_MAX} 之间` }, { status: 400 })
    }
  }
  let capTokens: number | null = null
  if (body?.capTokens !== undefined) {
    capTokens = parseCap(body.capTokens, NaN)
    if (capTokens === null) {
      return NextResponse.json({ error: '限额需为 0~10亿 的整数（0=不限）' }, { status: 400 })
    }
  }
  if (!hasEnabled && weight === null && capTokens === null) {
    return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 })
  }
  const row = await prisma.publicPoolModel.update({
    where: { id },
    data: {
      ...(hasEnabled ? { enabled: body.enabled } : {}),
      ...(weight !== null ? { weight } : {}),
      ...(capTokens !== null ? { capTokens } : {}),
    },
  }).catch(() => null)
  if (!row) return NextResponse.json({ error: '模型不存在' }, { status: 404 })
  return NextResponse.json({ model: row })
}

export async function DELETE(req: NextRequest) {
  const guarded = await guardAdmin()
  if (guarded instanceof NextResponse) return guarded

  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })
  const row = await prisma.publicPoolModel.delete({ where: { id } }).catch(() => null)
  if (!row) return NextResponse.json({ error: '模型不存在' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
