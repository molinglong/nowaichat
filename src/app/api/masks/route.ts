import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { STYLE_PRESETS } from '@/lib/ai/style-presets'
import { maskRowToDto } from '@/lib/ai/mask-resolve'
import { maskInputSchema } from '@/lib/ai/mask-types'

/** stylePreset 必须是合法 preset id，否则置 null */
function sanitizeStylePreset(v: string | null | undefined): string | null {
  if (!v) return null
  return STYLE_PRESETS.find((p) => p.id === v)?.id ?? null
}

/** GET /api/masks - 当前用户的自定义面具列表（按更新时间倒序） */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rows = await prisma.mask.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: 'desc' },
  })
  return NextResponse.json(rows.map(maskRowToDto))
}

/** POST /api/masks - 创建自定义面具，返回 DTO（id 为 user:<cuid> 完整引用） */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = maskInputSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  }
  const data = parsed.data

  try {
    const row = await prisma.mask.create({
      data: {
        userId: session.user.id,
        name: data.name,
        avatar: data.avatar,
        description: data.description,
        systemPrompt: data.systemPrompt,
        ...(data.fewShot ? { fewShot: data.fewShot } : {}),
        stylePreset: sanitizeStylePreset(data.stylePreset),
      },
    })
    return NextResponse.json(maskRowToDto(row), { status: 201 })
  } catch (err) {
    console.error('[masks] create failed:', err)
    return NextResponse.json({ error: '创建面具失败' }, { status: 500 })
  }
}
