/**
 * POST /api/study/quiz —— 按考点出题(课本例题举一反三，独立 RAG 注入模式)
 *
 * 与 chat 工具模式(search_knowledge)的分工：
 * - chat 内出题：模型自主决定是否翻书(agent 模式)，chat route 能力段引导
 * - 本 API：服务端必查课本(出题 100% 需要资料，无需模型决策)，先检索后生成，
 *   强制基于课本例题/练习举一反三，防超纲防口径漂移
 *
 * 返回结构化 JSON(区别于 chat 的试卷块流式渲染)：每题独立对象，
 * 便于前端自绘 UI 与逐题确认入库(/api/study/quiz/save)。
 * 模型解析沿用 resolveStudyModel(用户最近一次对话的模型)范式。
 */
import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { auth } from '@/lib/auth'
import { searchKnowledgeChunks } from '@/lib/ai/knowledge-tool-server'
import { resolveStudyModel } from '@/lib/study/tagging'

const QUIZ_SYSTEM = [
  '你是紧扣教材的出题助手。根据用户提供的课本原文出题，核心规则：',
  '- 题目必须从课本原文中的【例题】【练习】举一反三改编(换数字/换情境/逆向提问)，不得引入课本之外的考点',
  '- 输出严格的 JSON，不要任何其他文字或代码围栏，格式:',
  '{"items":[{"kind":"choice|answer","stem":"题干","options":[{"letter":"A","text":"..."}],"answer":"答案+分步解析","topic":"考点短语(不超过12字)","sourceRef":"出处，如 §2.2.1 例3"}]}',
  '- 选择题 kind=choice，必须给 options(4 项 A-D，letter 大写字母)；解答题 kind=answer，options 给空数组',
  '- answer 字段：选择题给「答案：X」加每个错误项的设误说明；解答题给答案加分步解析，标注用到的课本法则',
  '- 每题 sourceRef 必填，指向改编来源(课本例题/练习所在的章节号与栏目)',
  '- 题目表述贴近课本用词；难度按用户要求控制',
].join('\n')

const DIFFICULTY_LABELS: Record<string, string> = {
  basic: '基础(直接套用课本法则一步可得)',
  medium: '中等(需一两步转化)',
  hard: '提高(综合运用，可含易错点)',
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  let body: { topic?: string; count?: number; difficulty?: string; subject?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const topic = (body.topic ?? '').trim()
  if (!topic) {
    return NextResponse.json({ error: 'topic(考点)不能为空' }, { status: 400 })
  }
  const count = Math.min(Math.max(Math.trunc(Number(body.count)) || 5, 1), 10)
  const difficulty = DIFFICULTY_LABELS[body.difficulty ?? '']
    ? (body.difficulty as string)
    : 'medium'

  // 1. 课本检索(与 chat 工具同一共享检索核心)
  const hits = await searchKnowledgeChunks(userId, topic, body.subject)
  if (!hits.length) {
    return NextResponse.json(
      { error: `课本中未找到与「${topic}」相关的内容，请先上传对应教材或换个说法` },
      { status: 404 }
    )
  }

  // 2. 模型解析(沿用用户最近对话的模型)
  const model = await resolveStudyModel(userId)
  if (!model) {
    return NextResponse.json(
      { error: '没有可用的对话模型，请先在对话中使用一次模型' },
      { status: 400 }
    )
  }

  // 3. 基于课本原文生成
  const context = hits.map((h) => `【${h.doc}·${h.heading}】\n${h.content}`).join('\n\n')
  const { text } = await generateText({
    model,
    system: QUIZ_SYSTEM,
    prompt: [
      '## 课本原文(出题唯一依据)',
      context,
      '',
      '## 出题要求',
      `考点：${topic}`,
      `数量：${count} 题`,
      `难度：${DIFFICULTY_LABELS[difficulty]}`,
      '严格基于以上课本原文中的例题/练习举一反三，只输出 JSON。',
    ].join('\n'),
    temperature: 0.6,
  })

  // 剥围栏 + 解析(照 tagging.ts 范式)；解析失败返回原文让前端降级展示
  const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    const parsed = JSON.parse(raw) as { items?: unknown[] }
    const items = Array.isArray(parsed.items) ? parsed.items : []
    if (!items.length) throw new Error('empty items')
    return NextResponse.json({ topic, difficulty, count: items.length, items })
  } catch {
    return NextResponse.json({ topic, difficulty, raw, parseError: true })
  }
}
