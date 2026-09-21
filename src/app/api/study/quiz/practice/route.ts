/**
 * POST /api/study/quiz/practice - 题库练习结果回传(做错 → 转错题本)
 * body: { questionId, result: 'wrong'|'right', userAnswer? }
 * - wrong: 由 Question 同步建 StudyNote(FSRS newCardFields,dueAt=now 立即进今日队列);
 *   同题已有错题卡则幂等返回既有 noteId,不重复建卡。
 *   学科/考点直接继承 Question(超出 NOTE_SUBJECTS 降级 other),不走 AI 打标 —— 同步快速路径。
 * - right: 仅返回 ok(MVP 不回写题库统计)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { newCardFields } from '@/lib/study/fsrs'
import { NOTE_SUBJECTS } from '@/lib/study/tagging'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  let body: { questionId?: string; result?: string; userAnswer?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.questionId?.trim()) {
    return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
  }
  const userAnswer = (body.userAnswer ?? '').trim().slice(0, 2000)

  try {
    // 归属校验:非本人题目视为不存在
    const question = await prisma.question.findFirst({
      where: { id: body.questionId.trim(), userId },
    })
    if (!question) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 })
    }

    if (body.result !== 'wrong') {
      return NextResponse.json({ ok: true })
    }

    // 幂等:同题已建过错题卡直接复用,防重复刷题堆卡
    const existing = await prisma.studyNote.findFirst({
      where: { userId, sourceQuestionId: question.id },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) {
      return NextResponse.json({ noteId: existing.id, existing: true })
    }

    const card = newCardFields()
    const row = await prisma.studyNote.create({
      data: {
        userId,
        sourceQuestionId: question.id,
        subject: (NOTE_SUBJECTS as readonly string[]).includes(question.subject)
          ? question.subject
          : 'other',
        topic: question.topic,
        title: question.stem.replace(/\s+/g, ' ').trim().slice(0, 40) || '错题',
        content: question.stem + (userAnswer ? `\n\n我的答案:${userAnswer}` : ''),
        analysis: question.answer + (question.sourceRef ? `\n\n> 出处:${question.sourceRef}` : ''),
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

    return NextResponse.json({ noteId: row.id, existing: false }, { status: 201 })
  } catch (err) {
    console.error('[study/quiz/practice] failed:', err)
    return NextResponse.json({ error: '练习结果处理失败' }, { status: 500 })
  }
}
