import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/crypto"
import { createProviderInstanceForEffectiveModel } from "@/lib/ai/registry"
import type { ModelDefinition } from "@/lib/ai/types"

interface TestBody {
  provider: string
  modelId: string
  name: string
  contextWindow?: number
  supportsVision?: boolean
  supportsReasoning?: boolean
  supportsFiles?: boolean
  detectCapabilities?: boolean
}

async function detectProviderModelCapabilities(
  userId: string,
  modelDef: ModelDefinition,
  apiKey: string
): Promise<{ supportsVision: boolean; supportsReasoning: boolean }> {
  // Build a temporary model definition for capability detection
  const { generateText } = await import("ai")

  const provider = createProviderInstanceForEffectiveModel(modelDef, apiKey)

  // Vision detection: try with an image
  let supportsVision = false
  try {
    const visionResult = await generateText({
      model: provider(modelDef.id),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Reply with only the word: ok" },
            {
              type: "image",
              image: new URL(
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
              ),
            },
          ],
        },
      ],
      maxTokens: 5,
    })
    if (!visionResult.text.toLowerCase().includes("error")) {
      supportsVision = true
    }
  } catch {
    // Vision not supported
  }

  // Reasoning detection: check model name/id for reasoning indicators
  const reasoningKeywords = [
    "reasoning", "r1", "o1", "o3", "deepseek-r1", "deepseek-reasoner",
    "claude-3.7", "thinking", "openai-o1", "openai-o3", "gemini-2.5",
  ]
  const id = modelDef.id.toLowerCase()
  const name = modelDef.name.toLowerCase()
  const supportsReasoning = reasoningKeywords.some(k => id.includes(k) || name.includes(k))

  return { supportsVision, supportsReasoning }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const body: TestBody = await req.json().catch(() => ({}))
  const { provider, modelId, name, detectCapabilities } = body

  if (!provider || !modelId) {
    return NextResponse.json(
      { error: "provider 和 modelId 是必填项" },
      { status: 400 }
    )
  }

  // Build model definition from request body
  const modelDef: ModelDefinition = {
    id: modelId,
    name: name || modelId,
    provider,
    contextWindow: body.contextWindow ?? 32768,
    supportsVision: body.supportsVision ?? false,
    supportsFiles: body.supportsFiles ?? false,
    supportsReasoning: body.supportsReasoning ?? false,
  }

  // Fetch API key for the provider
  const apiKeyRecord = await prisma.apiKey.findUnique({
    where: { userId_provider: { userId, provider } },
  })

  let apiKey: string
  if (!apiKeyRecord) {
    // Fallback for qianwen: use env var
    if (provider === "qianwen") {
      apiKey = process.env.API_KEY_DASHSCOPE ?? ""
    }
    if (!apiKey) {
      return NextResponse.json(
        { error: `未配置 ${provider} 的 API Key` },
        { status: 400 }
      )
    }
  } else {
    try {
      apiKey = decrypt(apiKeyRecord.encryptedKey)
    } catch {
      return NextResponse.json(
        { error: "API Key 解密失败" },
        { status: 500 }
      )
    }
  }

  // Create provider and send test message
  const { generateText } = await import("ai")
  try {
    const prov = createProviderInstanceForEffectiveModel(modelDef, apiKey)
    const result = await generateText({
      model: prov(modelDef.id),
      messages: [{ role: "user", content: "Reply with only the word: ok" }],
      maxTokens: 5,
    })
    if (result.text.toLowerCase().includes("error")) {
      return NextResponse.json(
        { ok: false, error: `模型返回错误: ${result.text}` },
        { status: 502 }
      )
    }

    // Capability detection if requested
    let capabilities: { supportsVision: boolean; supportsReasoning: boolean } | undefined
    if (detectCapabilities) {
      try {
        capabilities = await detectProviderModelCapabilities(userId, modelDef, apiKey)
      } catch (err) {
        console.error("[provider-models/test] Capability detection error:", err)
      }
    }

    return NextResponse.json({ ok: true, capabilities })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "未知错误"
    const statusCode =
      err && typeof err === "object" && "statusCode" in err
        ? Number((err as { statusCode: unknown }).statusCode)
        : undefined
    const error =
      err && typeof err === "object" && "responseBody" in err
        ? `${message}: ${String((err as { responseBody: unknown }).responseBody)}`
        : message
    console.error("[provider-models/test] Error:", err)
    return NextResponse.json(
      { ok: false, error },
      {
        status:
          typeof statusCode === "number" && statusCode >= 400 && statusCode < 600
            ? statusCode
            : 502,
      }
    )
  }
}
