import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { guardAdmin } from '@/lib/admin'
import { providers } from '@/lib/ai/registry'

/**
 * 公共池服务端 Key 管理（管理员专属）。这是公共池「出钱主体」的钥匙：
 * 门面模型发上游时从这里取（见 lib/quota.ts getPublicPoolKey）。
 * PUT    { provider, apiKey }   存/换（upsert）
 * DELETE ?provider=             清除（deepseek 清除后回退环境变量兜底）
 *
 * 出参绝不回明文——掩码列表走主 GET /api/quota/admin 的 poolKeys。
 */
const KEY_MIN = 8
const KEY_MAX = 300

export async function PUT(req: NextRequest) {
  const guarded = await guardAdmin()
  if (guarded instanceof NextResponse) return guarded

  const body = await req.json().catch(() => null)
  const provider = typeof body?.provider === 'string' ? body.provider.trim() : ''
  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''

  if (!providers[provider]) {
    return NextResponse.json({ error: '未知服务商' }, { status: 400 })
  }
  if (apiKey.length < KEY_MIN || apiKey.length > KEY_MAX) {
    return NextResponse.json({ error: `Key 长度需 ${KEY_MIN}~${KEY_MAX} 个字符` }, { status: 400 })
  }

  await prisma.publicPoolKey.upsert({
    where: { provider },
    create: { provider, apiKey },
    update: { apiKey },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const guarded = await guardAdmin()
  if (guarded instanceof NextResponse) return guarded

  const provider = req.nextUrl.searchParams.get('provider') ?? ''
  if (!provider) return NextResponse.json({ error: '缺少 provider' }, { status: 400 })
  await prisma.publicPoolKey.deleteMany({ where: { provider } })
  return NextResponse.json({ ok: true })
}
