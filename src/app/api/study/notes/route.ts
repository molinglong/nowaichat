import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { NOTE_SUBJECTS, resolveStudyModel, tagNote, type NoteSubject } from '@/lib/study/tagging'
import { newCardFields } from '@/lib/study/fsrs'

/** GET /api/study/notes - 错题列表(筛选:subject/topic/q 关键字;按创建时间倒序) */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  const sp = req.nextUrl.searchParams
  const subject = sp.get('subject')
  const topic = sp.get('topic')
  const q = sp.get('q')?.trim()

  const where: Record<string, unknown> = { userId }
  if (subject && (NOTE_SUBJECTS as readonly string[]).includes(subject)) where.subject = subject
  if (topic) where.topic = topic
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { content: { contains: q, mode: 'insensitive' } },
      { topic: { contains: q, mode: 'insensitive' } },
    ]
  }

  try {
    const rows = await prisma.studyNote.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, sourceMessageId: true, subject: true, topic: true,
        title: true, content: true, analysis: true, mastery: true,
        dueAt: true, lastReviewAt: true, reps: true, lapses: true, createdAt: true,
      },
    })
    return NextResponse.json(rows)
  } catch (err) {
    console.error('[study/notes] list failed:', err)
    return NextResponse.json({ error: '获取错题列表失败' }, { status: 500 })
  }
}

/** POST /api/study/notes - 存入错题(题干必填,AI 讲解可选);先落库立即返回,后台异步打标 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  let body: { sourceMessageId?: string; questionText?: string; analysisText?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const questionText = (body.questionText ?? '').trim()
  const analysisText = (body.analysisText ?? '').trim() || null
  if (!questionText && !analysisText) {
    return NextResponse.json({ error: '题目内容不能为空' }, { status: 400 })
  }

  try {
    const card = newCardFields()
    const row = await prisma.studyNote.create({
      data: {
        userId,
        sourceMessageId: body.sourceMessageId?.trim() || null,
        // 降级初值:打标成功后由后台任务覆盖
        subject: 'other',
        title: questionText.replace(/\s+/g, ' ').trim().slice(0, 40) || '错题',
        content: questionText || '(本题以图片/附件形式提出,请回顾来源消息)',
        analysis: analysisText,
        mastery: 0,
        stability: card.stability,
        difficulty: card.difficulty,
        state: card.state,
        dueAt: card.dueAt,
        reps: card.reps,
        lapses: card.lapses,
      },
      select: { id: true, title: true, createdAt: true },
    })

    // 后台异步打标(参照 title-generator 的"异步执行,失败自动降级"模式)
    void (async () => {
      try {
        const model = await resolveStudyModel(userId)
        if (!model) return
        const tags = await tagNote(model, questionText, analysisText)
        if (!tags) return
        await prisma.studyNote.update({
          where: { id: row.id },
          data: { subject: tags.subject, topic: tags.topic, title: tags.title },
        })
      } catch (err) {
        console.error('[study/notes] tagging failed:', err)
      }
    })()

    return NextResponse.json(row, { status: 201 })
  } catch (err) {
    console.error('[study/notes] create failed:', err)
    return NextResponse.json({ error: '存入错题本失败' }, { status: 500 })
  }
}
