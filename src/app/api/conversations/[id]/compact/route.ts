import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/crypto"
import {
  getEffectiveModel,
  createProviderInstanceForEffectiveModel,
} from "@/lib/ai/registry"
import {
  buildCustomModelDefinition,
  resolveApiKey,
  createCustomLanguageModel,
} from "@/lib/ai/custom-model"
import { maybeCompressContext } from "@/lib/context-compression"
import type { ModelDefinition } from "@/lib/ai/types"
import type { LanguageModel } from "ai"

export const maxDuration = 60 // 手动压缩走一次 LLM 摘要,给 60s 兜底

/**
 * POST /api/conversations/[id]/compact - 手动触发一次上下文压缩
 *
 * 复用 maybeCompressContext(force) 跳过阈值检查;消息总数不足以压缩
 * (少于 MIN_RECENT_TURNS*2 条)时返回 compressed:false,不报错。
 * resolveModel 与 conversations/branch 保持同一套解析逻辑。
 */

/** 构造可用的 LanguageModel,失败返回 null 让上层返回 400。 */
async function resolveModel(
  userId: string,
  modelId: string
): Promise<{ model: LanguageModel; modelDef: ModelDefinition } | null> {
  if (modelId.startsWith("custom:")) {
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
  } else if (modelDef.provider === "qianwen") {
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

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = params

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, model: true },
  })
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const resolved = await resolveModel(session.user.id, conversation.model)
  if (!resolved) {
    return NextResponse.json(
      { error: "当前会话模型不可用(未配置 API Key 或模型已失效),无法压缩" },
      { status: 400 }
    )
  }

  // 取最近一轮 user/assistant 文本作为压缩输入的口径参数(force 模式下
  // 不参与阈值判断,但函数签名要求传值)
  const recent = await prisma.message.findMany({
    where: { conversationId: id, archived: false, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: { role: true, content: true },
  })
  const userText = recent.find((m) => m.role === "user")?.content ?? ""
  const assistantText = recent.find((m) => m.role === "assistant")?.content ?? ""

  const totalMessages = await prisma.message.count({
    where: { conversationId: id, archived: false, role: { in: ["user", "assistant"] } },
  })

  const compressed = await maybeCompressContext({
    conversationId: id,
    modelId: conversation.model,
    model: resolved.model,
    userText,
    assistantText,
    contextWindow: resolved.modelDef.contextWindow,
    totalMessages,
    force: true,
  })

  if (!compressed) {
    return NextResponse.json({
      ok: true,
      compressed: false,
      message: "消息数量还不足以压缩(至少需要 12 条以上)",
    })
  }

  return NextResponse.json({ ok: true, compressed: true })
}
