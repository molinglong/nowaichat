import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import {
  getEffectiveModel,
  createProviderInstanceForEffectiveModel,
} from '@/lib/ai/registry'
import {
  buildCustomModelDefinition,
  resolveApiKey,
  createCustomLanguageModel,
} from '@/lib/ai/custom-model'
import { generateConversationTitle } from '@/lib/ai/title-generator'
import type { ModelDefinition } from '@/lib/ai/types'
import type { LanguageModel } from 'ai'
import { isEphemeralSession } from '@/lib/ephemeral'

export const maxDuration = 60 // 压缩一次 LLM 调用,给 60s 兜底

/**
 * 「在新对话继续」
 * 与普通的「另存为」(POST /api/conversations body.cloneFrom)不同,
 * 这里会先用 LLM 把整段对话压缩成结构化摘要,
 * 再用「1 条 system 摘要 + N 条原始消息」的形式创建新对话。
 *
 * 摘要内容直接作为 system message 注入,新对话展开后模型能立刻知道上下文,
 * 同时避免把成百上千条历史消息全部带走导致的 token 浪费。
 *
 * 兜底:压缩失败时回退到完整克隆,保证功能不退化。
 */

interface BranchRequestBody {
  sourceId: string
  /** 用户输入框当前未发送的草稿,作为新对话的首条 user 消息(可选) */
  draft?: string
}

/** 构造可用的 LanguageModel,失败抛错让上层走兜底分支。 */
async function resolveModel(
  userId: string,
  modelId: string
): Promise<{ model: LanguageModel; modelDef: ModelDefinition } | null> {
  if (modelId.startsWith('custom:')) {
    const cmId = modelId.slice(7)
    const cmRecord = await prisma.customModel.findFirst({ where: { id: cmId, userId } })
    if (!cmRecord) return null
    const modelDef = buildCustomModelDefinition(cmRecord)
    const apiKey = await resolveApiKey(userId, cmRecord)
    return { model: createCustomLanguageModel(cmRecord, apiKey), modelDef }
  }

  const modelDef = await getEffectiveModel(userId, modelId)
  if (!modelDef) return null

  const apiKeyRecord = await prisma.apiKey.findUnique({
    where: { userId_provider: { userId, provider: modelDef.provider } },
  })

  let apiKey: string | undefined
  if (apiKeyRecord) {
    apiKey = decrypt(apiKeyRecord.encryptedKey)
  } else if (modelDef.provider === 'qianwen') {
    // 沿用 chat/route.ts 的回退逻辑: Qwen 可走环境变量 key
    apiKey = process.env.API_KEY_DASHSCOPE
  }
  if (!apiKey) return null

  try {
    return {
      model: createProviderInstanceForEffectiveModel(modelDef, apiKey)(modelDef.id),
      modelDef,
    }
  } catch {
    return null
  }
}

/** 调用 LLM 把整段对话压缩成结构化摘要。失败抛错给兜底。 */
async function compressConversation(
  model: LanguageModel,
  messages: { role: string; content: string }[]
): Promise<string> {
  const transcript = messages
    .map((m) => {
      const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? 'AI' : '系统'
      return `${role}: ${m.content}`
    })
    .filter(Boolean)
    .join('\n\n')

  // 极短的对话直接返回原文,免一次浪费钱的 LLM
  if (transcript.length < 240) {
    return `本对话内容简短,未做压缩。\n\n${transcript.slice(0, 800)}`
  }

  const prompt = `你是对话摘要助手。下面是一段完整对话历史,请压缩成结构化中文摘要,供后续在新对话中延续上下文使用。

【保留】
- 用户身份/目标/关键决定
- 已完成的重要结论、代码、方案、实体名称
- 未完成/待继续的问题
- 重要的偏好、约束、术语

【省略】
- 寒暄、确认、纯讨论过程
- 重复啰嗦的同一观点

【格式】直接输出 Markdown,使用以下骨架(若该部分为空可省略):
## 对话主题
（一句话）

## 已讨论
- ...

## 已完成 / 关键决定
- ...

## 待继续
- ...

## 关键术语 / 实体
- ...

控制在 600 字以内。不要"以下是摘要"等套话。

【对话历史】
${transcript.slice(0, 24000)}`

  const { text } = await generateText({
    model,
    temperature: 0,
    maxOutputTokens: 800,
    prompt,
    // 摘要任务不思考:省 token 与延迟(DeepSeek V4 默认 enabled)
    providerOptions: { deepseek: { thinking: { type: "disabled" } } },
  })
  return text.trim()
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id
    // 临时区隔离:分支新对话继承会话模式(临时模式下只能分支临时对话,反之亦然)
    const isEphemeral = isEphemeralSession(session)

    const body = (await req.json().catch(() => ({}))) as BranchRequestBody
    const sourceId = body?.sourceId
    if (!sourceId) {
      return NextResponse.json({ error: 'sourceId required' }, { status: 400 })
    }
    const draft = typeof body.draft === 'string' ? body.draft.trim() : ''

    // 1) 读取源对话(含临时区隔离:跨区分支视为不存在)
    const source = await prisma.conversation.findFirst({
      where: { id: sourceId, userId, isEphemeral },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
    if (!source) {
      return NextResponse.json({ error: 'Source conversation not found' }, { status: 404 })
    }

    const nonSystemMessages = source.messages.filter((m) => m.role !== 'system')
    if (nonSystemMessages.length === 0) {
      return NextResponse.json(
        { error: '源对话没有可压缩的消息' },
        { status: 400 }
      )
    }

    // 2) 解析模型(优先用源对话的模型,失败则压缩也走兜底克隆)
    const resolved = await resolveModel(userId, source.model)

    // 3) 尝试压缩(失败兜底到直接克隆)
    let summary: string | null = null
    let compressionFailed = false
    if (resolved) {
      try {
        summary = await compressConversation(
          resolved.model,
          source.messages.map((m) => ({ role: m.role, content: m.content }))
        )
      } catch (err) {
        console.error('[branch] compression failed:', err)
        compressionFailed = true
      }
    } else {
      compressionFailed = true
    }

    // 4) 构造新对话内容
    const newTitle = `${source.title || '对话'} (续)`
    const summaryHeader = '## 来自上文的上下文摘要(系统自动生成)'

    if (summary && !compressionFailed) {
      // 压缩版: 1 条 system 摘要 + 可选的 1 条 user 草稿
      // metadata.kind='branch_summary' 让前端识别为可折叠的摘要卡片
      // (而非普通 system 文本),sourceId/sourceTitle 用于跳回源对话
      const summaryMetadata = JSON.stringify({
        kind: 'branch_summary',
        version: 1,
        sourceId: source.id,
        sourceTitle: source.title || '对话',
        branchedAt: new Date().toISOString(),
      })
      const newConv = await prisma.conversation.create({
        data: {
          userId,
          isEphemeral,
          title: newTitle,
          model: source.model,
          styleOffset: source.styleOffset,
          stylePreset: source.stylePreset,
          messages: {
            create: [
              {
                role: 'system',
                content: `${summaryHeader}\n${summary}`,
                metadata: summaryMetadata,
              },
              ...(draft
                ? [
                    {
                      role: 'user' as const,
                      content: draft,
                    },
                  ]
                : []),
            ],
          },
        },
      })

      // 异步用 AI 给新对话生成更精准的标题(失败不阻塞主流程)
      if (resolved) {
        generateConversationTitle(
          draft || summary.slice(0, 200),
          resolved.model
        )
          .then(async (aiTitle) => {
            try {
              await prisma.conversation.update({
                where: { id: newConv.id },
                data: { title: aiTitle },
              })
            } catch (err) {
              console.error('[branch] failed to update AI title:', err)
            }
          })
          .catch(() => undefined)
      }

      console.log(
        `[branch] compressed conv=${sourceId} -> ${newConv.id} ` +
          `(${summary.length} chars summary)`
      )
      return NextResponse.json(
        {
          id: newConv.id,
          title: newConv.title,
          mode: 'compressed',
          summary,
        },
        { status: 201 }
      )
    }

    // 5) 兜底: 直接克隆全部消息(老 cloneFrom 行为)
    const clonedMessages = source.messages.filter(
      (m) => m.role === 'user' || m.role === 'system' || m.groupId == null || m.model === source.model
    )
    const newConv = await prisma.conversation.create({
      data: {
        userId,
        isEphemeral,
        title: newTitle,
        model: source.model,
        styleOffset: source.styleOffset,
        stylePreset: source.stylePreset,
        messages: {
          create: clonedMessages.map((m) => ({
            role: m.role,
            content: m.content,
            reasoning: m.reasoning,
            model: m.role === 'assistant' ? m.model : null,
            promptTokens: m.role === 'assistant' ? m.promptTokens : null,
            completionTokens: m.role === 'assistant' ? m.completionTokens : null,
          })),
        },
      },
    })
    console.warn(
      `[branch] fell back to cloneFor conv=${sourceId} -> ${newConv.id} ` +
        `(${clonedMessages.length} msgs)`
    )
    return NextResponse.json(
      {
        id: newConv.id,
        title: newConv.title,
        mode: 'cloned',
        warning: '压缩失败,已克隆原始消息',
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('[branch] unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal error', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
