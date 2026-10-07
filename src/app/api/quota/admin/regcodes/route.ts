import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { guardAdmin } from '@/lib/admin'

/**
 * 注册码管理（管理员专属，/api/quota/admin 前缀已被 middleware 对临时模式拦截）。
 * 注册为邀请制：注册必须携带这里生成的码（一码一用，防脚本批量注册烧公共池）。
 * POST   { count?, note? }   批量生成（code 自动 REG-XXXXXXXX，去易混淆字符）
 * PATCH  { code, enabled }   停用/启用
 * DELETE ?code=               删除（已使用的也可删：占用记录随之消失，但账号已建不受影响）
 *
 * 列表不在此处：主 GET /api/quota/admin 已带 regcodes（含注册人昵称），前端一次取全。
 */
const COUNT_MAX = 50
/** Crockford-ish:去掉易混淆的 I L O U 1（与激活码同一字母表） */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"

function genCode(): string {
  let s = ""
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return `REG-${s.slice(0, 4)}-${s.slice(4)}`
}

export async function POST(req: NextRequest) {
  const guarded = await guardAdmin()
  if (guarded instanceof NextResponse) return guarded

  const body = await req.json().catch(() => null)
  const count = Math.min(Math.max(Math.round(Number(body?.count ?? 1)) || 1, 1), COUNT_MAX)
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 60) : ''

  // 码冲突概率极低(31^8≈8.5e11),仍做重试兜底
  const rows: Array<{ code: string; note: string }> = []
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = genCode()
      const exists = await prisma.registerCode.findUnique({ where: { code }, select: { code: true } })
      if (exists) continue
      rows.push({ code, note })
      break
    }
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: '生成失败，请重试' }, { status: 500 })
  }
  await prisma.registerCode.createMany({ data: rows })
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
  const row = await prisma.registerCode.update({
    where: { code },
    data: { enabled: body.enabled },
  }).catch(() => null)
  if (!row) return NextResponse.json({ error: '注册码不存在' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const guarded = await guardAdmin()
  if (guarded instanceof NextResponse) return guarded

  const code = (req.nextUrl.searchParams.get('code') ?? '').trim().toUpperCase()
  if (!code) return NextResponse.json({ error: '缺少 code' }, { status: 400 })
  const row = await prisma.registerCode.delete({ where: { code } }).catch(() => null)
  if (!row) return NextResponse.json({ error: '注册码不存在' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
