import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { NOTE_SUBJECTS, type NoteSubject } from '@/lib/study/tagging'

/** PATCH /api/study/notes/[id] - 手动修正字段(题干/解析/学科/考点) */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { title?: string; content?: string; analysis?: string | null; subject?: string; topic?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (typeof body.title === 'string' && body.title.trim()) data.title = body.title.trim().slice(0, 40)
  if (typeof body.content === 'string' && body.content.trim()) data.content = body.content
  if (body.analysis !== undefined) data.analysis = body.analysis?.trim() || null
  if (body.subject !== undefined) {
    data.subject = (NOTE_SUBJECTS as readonly string[]).includes(body.subject)
      ? (body.subject as NoteSubject)
      : 'other'
  }
  if (body.topic !== undefined) data.topic = body.topic?.trim().slice(0, 12) || null
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 })
  }

  try {
    // 归属校验:非本人记录视为不存在
    const row = await prisma.studyNote.updateMany({
      where: { id: params.id, userId: session.user.id },
      data,
    })
    if (row.count === 0) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 })
    }
    const updated = await prisma.studyNote.findUnique({ where: { id: params.id } })
    return NextResponse.json(updated)
  } catch (err) {
    console.error('[study/notes] patch failed:', err)
    return NextResponse.json({ error: '更新错题失败' }, { status: 500 })
  }
}

/** DELETE /api/study/notes/[id] - 删除错题(复习流水随级联删除) */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const row = await prisma.studyNote.deleteMany({
      where: { id: params.id, userId: session.user.id },
    })
    if (row.count === 0) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[study/notes] delete failed:', err)
    return NextResponse.json({ error: '删除错题失败' }, { status: 500 })
  }
}
