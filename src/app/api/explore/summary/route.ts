/**
 * 真相摘要 API - 区分事实共识与价值分歧
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { getProviderForModel, createProviderInstance } from '@/lib/ai/registry'
import { generateText } from 'ai'

interface SummaryResult {
  factConsensus: {
    text: string
    source?: string
  }[]
  valueDivergence: {
    dimension: string
    proCost: string
    conCost: string
  }[]
  factsDisputed: {
    claim: string
    proView: string
    conView: string
    reason: string
  }[]
  reflection: string
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { topic, userMessages, opponentMessages, model: modelIdInput } = await request.json()

    if (!topic?.trim()) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
    }

    if ((!userMessages || userMessages.length === 0) && (!opponentMessages || opponentMessages.length === 0)) {
      return NextResponse.json({ error: 'No messages to summarize' }, { status: 400 })
    }

    const userId = session.user.id

    // 选择可用的内置模型: 优先用户传入, 否则按用户已配置 key 的优先级兜底
    const candidates = modelIdInput ? [modelIdInput, 'gpt-4o', 'claude-3-5-sonnet', 'deepseek-chat'] : [
      'gpt-4o',
      'claude-3-5-sonnet',
      'deepseek-chat',
      'gemini-1.5-pro',
    ]

    let chosenModelId: string | null = null
    let keyRecord: { encryptedKey: string } | null = null
    for (const id of candidates) {
      const provider = getProviderForModel(id)
      if (!provider) continue
      const rec = await prisma.apiKey.findUnique({
        where: { userId_provider: { userId, provider: provider.id } },
      })
      if (rec?.encryptedKey) {
        chosenModelId = id
        keyRecord = rec
        break
      }
    }

    if (!chosenModelId || !keyRecord) {
      return NextResponse.json(
        { error: '未配置任何可用的服务商 API Key，请先在设置中添加' },
        { status: 400 }
      )
    }

    const apiKey = decrypt(keyRecord.encryptedKey)

    // 构建消息历史
    const historyText = []
    if (userMessages && userMessages.length > 0) {
      historyText.push('【你的发言】\n' + userMessages.join('\n\n'))
    }
    if (opponentMessages && opponentMessages.length > 0) {
      historyText.push('【对手发言】\n' + opponentMessages.join('\n\n'))
    }

    const systemPrompt = `你是一个辩论裁判和思辨引导者。

给定一场辩论的完整对话，你需要：
1. 提炼出双方**公认的事实**（有共识的、可验证的）
2. 区分**事实分歧**（数据/事件层面的争议）和**价值分歧**（优先级/权衡层面的不可通约）
3. 对于**价值分歧**，不要强行制造"正确答案"，而是呈现各方选择的代价
4. 给出简短的思考引导

**重要原则**：
- 事实部分：给出明确共识，标注来源（如果知道的话）
- 价值部分：保留"不可通约性"，只呈现权衡的代价

请以 JSON 格式返回结果：
{
  "factConsensus": [
    {
      "text": "共识事实描述",
      "source": "来源（可选）"
    }
  ],
  "factsDisputed": [
    {
      "claim": "争议的声明",
      "proView": "正方观点",
      "conView": "反方观点",
      "reason": "争议原因（方法论/数据来源等）"
    }
  ],
  "valueDivergence": [
    {
      "dimension": "分歧维度（如：发展vs环保）",
      "proCost": "选正方的代价",
      "conCost": "选反方的代价"
    }
  ],
  "reflection": "简短的思考引导（1-2句话），引导用户深入思考"
}`

    const userPrompt = `辩论主题：${topic}

${historyText.join('\n\n')}`

    const aiProvider = createProviderInstance(chosenModelId, apiKey)
    const result = await generateText({
      model: aiProvider(chosenModelId),
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const summary = JSON.parse(jsonMatch[0])
        return NextResponse.json({ summary })
      }
    } catch {
      // JSON 解析失败，尝试返回基础结果
    }

    // 如果无法解析 JSON，返回文本结果
    return NextResponse.json({
      summary: {
        factConsensus: [{ text: '无法自动提取共识，请查阅辩论内容' }],
        valueDivergence: [],
        factsDisputed: [],
        reflection: '辩论涉及复杂议题，建议进一步研究相关领域。',
      },
    })
  } catch (error) {
    console.error('[explore/summary] Error:', error)
    return NextResponse.json(
      { error: 'Summary generation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}