import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { STYLE_PRESETS } from '@/lib/ai/style-presets'
import { maskRowToDto } from '@/lib/ai/mask-resolve'
import { maskInputSchema, USER_MASK_PREFIX } from '@/lib/ai/mask-types'

function sanitizeStylePreset(v: string | null | undefined): string | null {
  if (!v) return null
  return STYLE_PRESETS.find((p) => p.id === v)?.id ?? null
}

/** PATCH /api/masks/[id] - 全量更新自定义面具（id 为裸 cuid；归属校验内嵌 where） */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id
  const { id } = params

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
    // updateMany 的 where 带 userId，归属不符时 count=0（不泄露存在性）
    const updated = await prisma.mask.updateMany({
      where: { id, userId },
      data: {
        name: data.name,
        avatar: data.avatar,
        description: data.description,
        systemPrompt: data.systemPrompt,
        ...(data.fewShot !== undefined ? { fewShot: data.fewShot } : {}),
        stylePreset: sanitizeStylePreset(data.stylePreset),
      },
    })
    if (updated.count === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const row = await prisma.mask.findFirst({ where: { id, userId } })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(maskRowToDto(row))
  } catch (err) {
    console.error('[masks] update failed:', err)
    return NextResponse.json({ error: '更新面具失败' }, { status: 500 })
  }
}

/** DELETE /api/masks/[id] - 删除自定义面具，并把引用它的会话重置为无面具 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id
  const { id } = params

  try {
    const [del, convs] = await prisma.$transaction([
      prisma.mask.deleteMany({ where: { id, userId } }),
      // 引用该面具的会话清掉 maskId（降级为无面具，不会 404）
      prisma.conversation.updateMany({
        where: { maskId: `${USER_MASK_PREFIX}${id}`, userId },
        data: { maskId: null },
      }),
    ])
    if (del.count === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, conversationsCleared: convs.count })
  } catch (err) {
    console.error('[masks] delete failed:', err)
    return NextResponse.json({ error: '删除面具失败' }, { status: 500 })
  }
}
