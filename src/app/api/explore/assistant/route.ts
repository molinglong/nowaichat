/**
 * 助手分析 API - 逻辑审查、论据搜索辅助、文本润色
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { getProviderForModel, createProviderInstance, getModel, getEffectiveModel } from '@/lib/ai/registry'
import { generateText } from 'ai'
import {
  resolveApiKey,
  createCustomLanguageModel,
  type CustomModelRow,
} from '@/lib/ai/custom-model'

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { type, content, topic, model: modelId, conversationHistory, contextSnippets } = await request.json()

    if (!type || !content?.trim()) {
      return NextResponse.json({ error: 'Type and content are required' }, { status: 400 })
    }

    const userId = session.user.id
    const model = modelId || 'gpt-4o'

    // 1. 内置模型路径
    let provider = getProviderForModel(model)
    let apiKey: string | undefined
    let aiModel: any

    // 1a. 如果内置查不到且不是 custom: 前缀，则尝试匹配用户级覆盖（ProviderModelOverride 表里的新增模型）
    //     命中后复用其 provider 的内置实例（用同一份 API Key）
    if (!provider && !model.startsWith('custom:')) {
      const userLevelModel = await getEffectiveModel(userId, model)
      if (userLevelModel && userLevelModel.provider !== 'custom') {
        const { providers: builtinProviders } = await import('@/lib/ai/registry')
        provider = builtinProviders[userLevelModel.provider]
      }
    }

    if (provider) {
      const keyRecord = await prisma.apiKey.findUnique({
        where: { userId_provider: { userId, provider: provider.id } },
      })
      if (!keyRecord?.encryptedKey) {
        return NextResponse.json(
          { error: `未配置 ${provider.name || provider.id} 的 API Key` },
          { status: 400 }
        )
      }
      apiKey = decrypt(keyRecord.encryptedKey)
      const aiProvider = createProviderInstance(model, apiKey)
      aiModel = aiProvider(model)
    } else if (model.startsWith('custom:')) {
      // 2. 自定义模型路径
      const customId = model.slice('custom:'.length)
      const cm = await prisma.customModel.findFirst({
        where: { id: customId, userId },
      })
      if (!cm) {
        return NextResponse.json({ error: '自定义模型不存在' }, { status: 404 })
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
      apiKey = await resolveApiKey(userId, row)
      aiModel = createCustomLanguageModel(row, apiKey)
    } else {
      return NextResponse.json({ error: `未知模型: ${model}` }, { status: 400 })
    }

    // 根据类型构建提示
    let systemPrompt = ''
    const userPrompt = content

    switch (type) {
      case 'logic':
        systemPrompt = `你是一位辩论教练，负责审查用户的辩论论点。
请从以下几个维度进行审查：
1. 逻辑谬误（滑坡论证、人身攻击、稻草人谬误、虚假两难等）
2. 证据充分性（是否有数据、研究支撑？）
3. 论点一致性（是否自相矛盾？）
4. 可预见的反驳点（对方可能如何攻击你的论点？）

请用简洁、专业的语言给出反馈。`
        break

      case 'polish':
        systemPrompt = `你是一位写作润色专家，负责帮助用户优化辩论发言。
请在保持原意的基础上，让文字更加：
1. 逻辑清晰
2. 表达有力
3. 有说服力
4. 避免情绪化用语

请直接给出润色后的版本，不要过多解释。`
        break

      case 'evidence-suggestion':
        systemPrompt = `你是一位研究助手。
根据用户给定的议题和搜索证据，你需要：
1. 用 2-3 句话直接总结这些证据对该议题的整体倾向（支持 / 反对 / 混合）
2. 指出最值得引用的一两条核心证据（用一句话提及标题或来源即可）
3. 不要列条目，不要 markdown，直接给连续段落
4. 保持中文`
        break

      default:
        return NextResponse.json({ error: 'Unknown analysis type' }, { status: 400 })
    }

    // 构建消息
    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = []

    if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      messages.push({
        role: 'system',
        content: `辩论主题：${topic || '未指定'}`,
      })
      messages.push({
        role: 'system',
        content: `辩论历史：\n${conversationHistory.map((m: { role: string; content: string }, i: number) =>
          `${i + 1}. [${m.role}] ${m.content}`
        ).join('\n')}`,
      })
    }

    // 搜索证据片段 (用于 evidence-suggestion)
    if (contextSnippets && Array.isArray(contextSnippets) && contextSnippets.length > 0) {
      messages.push({
        role: 'system',
        content: `搜索证据：\n${contextSnippets.map((s: { title: string; snippet: string; source?: string }, i: number) =>
          `${i + 1}. ${s.title}${s.source ? ` (${s.source})` : ''}\n   ${s.snippet}`
        ).join('\n\n')}`,
      })
    }

    messages.push({ role: 'user', content: userPrompt })

    // 生成分析
    const result = await generateText({
      model: aiModel,
      system: systemPrompt,
      messages,
    })

    return NextResponse.json({
      analysis: result.text,
    })
  } catch (error) {
    console.error('[explore/assistant] Error:', error)
    return NextResponse.json(
      { error: 'Analysis failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}