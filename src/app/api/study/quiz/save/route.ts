/**
 * POST /api/study/quiz/save —— 出题确认入库(批量收进题库 Question 表)
 *
 * 与生成端点分离：出题即时生成不入库，用户练习后觉得靠谱才收进题库，
 * 保证题库里都是人工确认过的题。部分成功语义：逐题校验，
 * 不合格的跳过并在响应里报告 skipped 数，不阻塞合格的题。
 * 未来 exam_import(试卷/第三方练习册导入)复用本端点，传 source 即可。
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

const KINDS = ['choice', 'answer']
const DIFFICULTIES = ['basic', 'medium', 'hard']
const SUBJECTS = ['math', 'chinese', 'english', 'physics', 'chemistry', 'biology', 'other']
const SOURCES = ['ai_generated', 'exam_import']

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  let body: { items?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const rawItems = Array.isArray(body.items) ? body.items : []
  if (!rawItems.length) {
    return NextResponse.json({ error: 'items 不能为空' }, { status: 400 })
  }
  if (rawItems.length > 20) {
    return NextResponse.json({ error: '单次最多入库 20 题' }, { status: 400 })
  }

  const valid: {
    subject: string
    topic: string | null
    kind: string
    stem: string
    answer: string
    difficulty: string
    source: string
    sourceRef: string | null
  }[] = []
  let skipped = 0
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') {
      skipped++
      continue
    }
    const o = it as Record<string, unknown>
    const subject =
      typeof o.subject === 'string' && SUBJECTS.includes(o.subject) ? o.subject : null
    const kind = typeof o.kind === 'string' && KINDS.includes(o.kind) ? o.kind : null
    const stem = typeof o.stem === 'string' ? o.stem.trim() : ''
    const answer = typeof o.answer === 'string' ? o.answer.trim() : ''
    if (!subject || !kind || !stem || !answer) {
      skipped++
      continue
    }
    valid.push({
      subject,
      topic:
        typeof o.topic === 'string' && o.topic.trim() ? o.topic.trim().slice(0, 12) : null,
      kind,
      stem: stem.slice(0, 2000),
      answer: answer.slice(0, 4000),
      difficulty:
        typeof o.difficulty === 'string' && DIFFICULTIES.includes(o.difficulty)
          ? o.difficulty
          : 'medium',
      source:
        typeof o.source === 'string' && SOURCES.includes(o.source) ? o.source : 'ai_generated',
      sourceRef:
        typeof o.sourceRef === 'string' && o.sourceRef.trim()
          ? o.sourceRef.trim().slice(0, 100)
          : null,
    })
  }

  if (!valid.length) {
    return NextResponse.json(
      { error: '没有一题通过校验(subject/kind/stem/answer 必填)' },
      { status: 400 }
    )
  }

  const created = await prisma.question.createMany({
    data: valid.map((v) => ({ ...v, userId })),
  })
  return NextResponse.json({ saved: created.count, skipped })
}
