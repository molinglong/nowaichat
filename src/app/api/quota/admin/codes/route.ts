import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { guardAdmin } from '@/lib/admin'

/**
 * 激活码管理（管理员专属，/api/quota/admin 前缀已被 middleware 对临时模式拦截）。
 * POST   { tokens, count?, note? }  批量生成（code 自动 ACH-XXXXXXXX，去易混淆字符）
 * PATCH  { code, enabled }          停用/启用
 * DELETE ?code=                     删除（已兑换的也可删:余额由 ledger 流水推导,删码不影响到账）
 *
 * 列表不在此处：主 GET /api/quota/admin 已带 codes（含兑换人昵称），前端一次取全。
 */
const TOKENS_MIN = 1_000
const TOKENS_MAX = 10_000_000
const COUNT_MAX = 50
/** Crockford-ish:去掉易混淆的 I L O U 1 */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"

function genCode(): string {
  let s = ""
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return `ACH-${s.slice(0, 4)}-${s.slice(4)}`
}

export async function POST(req: NextRequest) {
  const guarded = await guardAdmin()
  if (guarded instanceof NextResponse) return guarded

  const body = await req.json().catch(() => null)
  const tokens = Math.round(Number(body?.tokens))
  const count = Math.min(Math.max(Math.round(Number(body?.count ?? 1)) || 1, 1), COUNT_MAX)
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 60) : ''

  if (!Number.isFinite(tokens) || tokens < TOKENS_MIN || tokens > TOKENS_MAX) {
    return NextResponse.json({ error: `面值需在 ${TOKENS_MIN}~${TOKENS_MAX} tokens 之间` }, { status: 400 })
  }

  // 码冲突概率极低(31^8≈8.5e11),仍做重试兜底
  const rows: Array<{ code: string; tokens: number; note: string }> = []
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = genCode()
      const exists = await prisma.quotaRedeemCode.findUnique({ where: { code }, select: { code: true } })
      if (exists) continue
      rows.push({ code, tokens, note })
      break
    }
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: '生成失败，请重试' }, { status: 500 })
  }
  await prisma.quotaRedeemCode.createMany({ data: rows })
  return NextResponse.json({ codes: rows.map((r) => r.code), count: rows.length })
}

export async function PATCH(req: NextRequest) {
  const guarded = await guardAdmin()
  if (guarded instanceof NextResponse) return guarded

  const body = await req.json().catch(() => null)
  const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : ''
  if (!code || typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: '参数不完整' }, { status: 400 })
  }
  const row = await prisma.quotaRedeemCode.update({
    where: { code },
    data: { enabled: body.enabled },
  }).catch(() => null)
  if (!row) return NextResponse.json({ error: '激活码不存在' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const guarded = await guardAdmin()
  if (guarded instanceof NextResponse) return guarded

  const code = (req.nextUrl.searchParams.get('code') ?? '').trim().toUpperCase()
  if (!code) return NextResponse.json({ error: '缺少 code' }, { status: 400 })
  const row = await prisma.quotaRedeemCode.delete({ where: { code } }).catch(() => null)
  if (!row) return NextResponse.json({ error: '激活码不存在' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
