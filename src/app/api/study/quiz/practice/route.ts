/**
 * POST /api/study/quiz/practice - 题库练习结果回传(做错 → 转错题本)
 * body: { questionId, result: 'wrong'|'right', userAnswer? }
 * 落库核心与对话练题(record_practice 工具)共用 lib/study/question-bank.ts，
 * 保证两条路径同口径:wrong → StudyNote(FSRS)幂等建卡;right → 仅返回 ok。
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { recordPracticeAttempt } from '@/lib/study/question-bank'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: '登录已失效，请重新登录后再试' }, { status: 401 })
  }
  const userId = session.user.id

  let body: { questionId?: string; result?: string; userAnswer?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体不是合法的 JSON' }, { status: 400 })
  }
  if (!body.questionId?.trim()) {
    return NextResponse.json({ error: '缺少 questionId' }, { status: 400 })
  }
  const result = body.result === 'wrong' ? 'wrong' : 'right'

  try {
    const r = await recordPracticeAttempt(userId, body.questionId.trim(), result, body.userAnswer)
    // 归属校验:非本人题目视为不存在(核心内按 notfound 处理)
    if (r.outcome === 'notfound') {
      return NextResponse.json({ error: '内容不存在或已被删除' }, { status: 404 })
    }
    if (r.outcome === 'ok') {
      return NextResponse.json({ ok: true })
    }
    if (r.outcome === 'card-existing') {
      return NextResponse.json({ noteId: r.noteId, existing: true })
    }
    return NextResponse.json({ noteId: r.noteId, existing: false }, { status: 201 })
  } catch (err) {
    console.error('[study/quiz/practice] failed:', err)
    return NextResponse.json({ error: '练习结果处理失败' }, { status: 500 })
  }
}
