/**
 * 润色 API
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { getProviderForModel, createProviderInstance } from '@/lib/ai/registry'
import {
  resolveApiKey,
  createCustomLanguageModel,
  type CustomModelRow,
} from '@/lib/ai/custom-model'
import { generateText } from 'ai'

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { content, topic, model: modelId } = await request.json()

    if (!content?.trim()) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    const userId = session.user.id
    const model = modelId || 'gpt-4o'

    // 1. 内置模型路径
    const provider = getProviderForModel(model)
    let aiModel: any

    if (provider) {
      const keyRecord = await prisma.apiKey.findUnique({
        where: { userId_provider: { userId, provider: provider.id } },
      })
      if (!keyRecord?.encryptedKey) {
        // 没有 API Key 时返回原文(原行为保持兼容)
        return NextResponse.json({ polished: content })
      }
      const apiKey = decrypt(keyRecord.encryptedKey)
      const aiProvider = createProviderInstance(model, apiKey)
      aiModel = aiProvider(model)
    } else if (model.startsWith('custom:')) {
      // 2. 自定义模型路径
      const customId = model.slice('custom:'.length)
      const cm = await prisma.customModel.findFirst({
        where: { id: customId, userId },
      })
      if (!cm) {
        return NextResponse.json({ polished: content })
      }
      const row: CustomModelRow = {
        id: cm.id,
        userId: cm.userId,
        name: cm.name,
        modelId: cm.modelId,
        baseURL: cm.baseURL,
        protocol: cm.protocol,
        apiKey: cm.apiKey,
        keyProvider: cm.keyProvider,
        contextWindow: cm.contextWindow,
        supportsVision: cm.supportsVision,
        supportsFiles: cm.supportsFiles,
        supportsReasoning: cm.supportsReasoning,
      }
      const apiKey = await resolveApiKey(userId, row)
      aiModel = createCustomLanguageModel(row, apiKey)
    } else {
      return NextResponse.json({ polished: content })
    }

    const systemPrompt = `你是一位写作润色专家，负责帮助用户优化辩论发言。
请在保持原意的基础上，让文字更加：
1. 逻辑清晰
2. 表达有力
3. 有说服力
4. 避免情绪化用语

请直接给出润色后的版本，不要过多解释。如果原文已经很好，可以稍作调整即可。`

    const userPrompt = topic ? `辩论主题：${topic}\n\n原文：\n${content}` : `原文：\n${content}`

    const result = await generateText({
      model: aiModel,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    return NextResponse.json({
      polished: result.text.trim(),
    })
  } catch (error) {
    console.error('[explore/polish] Error:', error)
    return NextResponse.json(
      { error: 'Polish failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}