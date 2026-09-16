/**
 * 对手 AI 生成论点
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { getProviderForModel, createProviderInstance } from '@/lib/ai/registry'
import { generateText } from 'ai'

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { topic, model: modelId, conversationHistory, opponentHistory } = await request.json()

    if (!topic?.trim()) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
    }

    const userId = session.user.id

    // 获取模型对应的 API Key
    const provider = getProviderForModel(modelId)
    if (!provider) {
      return NextResponse.json({ error: 'Unknown model' }, { status: 400 })
    }

    const keyRecord = await prisma.apiKey.findUnique({
      where: { userId_provider: { userId, provider: provider.id } },
    })

    if (!keyRecord?.encryptedKey) {
      return NextResponse.json({ error: `No API key for ${provider.name}` }, { status: 401 })
    }

    const apiKey = decrypt(keyRecord.encryptedKey)

    // 构建系统提示
    const systemPrompt = `你是一位辩手，参与一场关于「${topic}」的辩论。
你的角色是反方（持反对观点）。
请用犀利、有逻辑、有数据支撑的方式表达你的观点。
论点要简洁有力，每轮不超过 200 字。
避免重复之前的论点，力求新角度。
适当引用研究数据或真实案例来支撑你的观点。`

    // 构建消息历史
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []

    // 添加对手历史（作为 AI 之前的发言）
    if (opponentHistory && Array.isArray(opponentHistory)) {
      opponentHistory.forEach((msg: { role: string; content: string }) => {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })
      })
    }

    // 添加用户历史
    if (conversationHistory && Array.isArray(conversationHistory)) {
      conversationHistory.forEach((msg: { role: string; content: string }) => {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })
      })
    }

    // 添加当前回合的提示
    const userPrompt = conversationHistory && conversationHistory.length > 0
      ? `用户刚刚发表了观点，请作为反方进行回应和反驳：\n"${conversationHistory[conversationHistory.length - 1]?.content}"`
      : `请发表你作为反方的开场陈词。`

    messages.push({ role: 'user', content: userPrompt })

    // 生成回应
    const aiProvider = createProviderInstance(modelId, apiKey)
    const result = await generateText({
      model: aiProvider(modelId),
      system: systemPrompt,
      messages,
    })

    return NextResponse.json({
      content: result.text,
    })
  } catch (error) {
    console.error('[explore/opponent] Error:', error)
    return NextResponse.json(
      { error: 'Failed to generate opponent response', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
