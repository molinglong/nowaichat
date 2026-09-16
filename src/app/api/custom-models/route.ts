import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { encrypt } from "@/lib/crypto"
import { buildCustomModelDefinition } from "@/lib/ai/custom-model"

/**
 * GET /api/custom-models
 * 返回当前用户的自定义模型列表。
 * 每条记录同时兼容 ModelSelector(ModelDefinition 格式, id 带 custom: 前缀)
 * 和设置页(额外带 dbId/modelId/baseURL/keySource 等字段)。
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const customModels = await prisma.customModel.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  })

  const result = customModels.map((cm) => ({
    // ModelDefinition 兼容字段
    id: `custom:${cm.id}`,
    name: cm.name,
    provider: "custom",
    contextWindow: cm.contextWindow,
    supportsVision: cm.supportsVision,
    supportsFiles: cm.supportsFiles,
    supportsReasoning: cm.supportsReasoning,
    // 设置页额外字段
    dbId: cm.id,
    modelId: cm.modelId,
    baseURL: cm.baseURL,
    protocol: cm.protocol,
    hasApiKey: !!cm.apiKey,
    keySource: cm.apiKey ? "own" : cm.keyProvider ? "provider" : "none",
    providerKey: cm.keyProvider,
    updatedAt: cm.updatedAt,
  }))

  return NextResponse.json(result)
}

/**
 * POST /api/custom-models
 * Body: { name, modelId, baseURL, apiKey?, keyProvider?, contextWindow, supportsVision, supportsFiles, supportsReasoning }
 * 创建或更新自定义模型（通过 id 字段实现 upsert）
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const {
    id,
    name,
    modelId,
    baseURL,
    protocol = "auto",
    apiKey,
    keyProvider,
    keySource,
    contextWindow = 32768,
    supportsVision = false,
    supportsFiles = false,
    supportsReasoning = false,
  } = body

  const normalizedProtocol = ['auto', 'chat', 'responses', 'anthropic'].includes(protocol) ? protocol : 'auto'

  if (!name || !modelId) {
    return NextResponse.json(
      { error: "名称和模型 ID 是必填项" },
      { status: 400 }
    )
  }
  // Base URL：复用服务商 Key 时可留空（运行时使用该服务商原生接口）
  if (!baseURL && !keyProvider) {
    return NextResponse.json(
      { error: "Base URL 必填（复用服务商 Key 时可留空）" },
      { status: 400 }
    )
  }

  const userId = session.user.id

  // 处理 API Key 加密：如果提供则加密存储；如果不提供且不是首次创建，保持原值不变（需额外处理，这里简化为不填即不存）
  let encryptedKey: string | null = null
  if (apiKey && apiKey.trim() !== "") {
    encryptedKey = encrypt(apiKey)
  } else if (!id) {
    // 首次创建且不填 key，允许留空
  }

  try {
    let record
    if (id) {
      // 更新：保留原 key 如果新键为空
      const existing = await prisma.customModel.findUnique({ where: { id } })
      if (!existing) {
        return NextResponse.json({ error: "模型不存在" }, { status: 404 })
      }
      // 只有当提供了新的 apiKey 时才更新加密后的 key；
      // keySource 决定 Key 来源：none 清空、provider 清空独立 Key
      if (apiKey && apiKey.trim() !== "") {
        record = await prisma.customModel.update({
          where: { id },
          data: {
            name,
            modelId,
            baseURL,
            protocol: normalizedProtocol,
            apiKey: encryptedKey,
            keyProvider,
            contextWindow,
            supportsVision,
            supportsFiles,
            supportsReasoning,
          },
        })
      } else if (keySource === "none") {
        record = await prisma.customModel.update({
          where: { id },
          data: {
            name,
            modelId,
            baseURL,
            protocol: normalizedProtocol,
            apiKey: null,
            keyProvider: null,
            contextWindow,
            supportsVision,
            supportsFiles,
            supportsReasoning,
          },
        })
      } else if (keyProvider) {
        record = await prisma.customModel.update({
          where: { id },
          data: {
            name,
            modelId,
            baseURL,
            protocol: normalizedProtocol,
            apiKey: null,
            keyProvider,
            contextWindow,
            supportsVision,
            supportsFiles,
            supportsReasoning,
          },
        })
      } else {
        // 不修改 apiKey，只更新其他字段
        record = await prisma.customModel.update({
          where: { id },
          data: {
            name,
            modelId,
            baseURL,
            protocol: normalizedProtocol,
            keyProvider,
            contextWindow,
            supportsVision,
            supportsFiles,
            supportsReasoning,
          },
        })
      }
    } else {
      // 创建
      record = await prisma.customModel.create({
        data: {
          userId,
          name,
          modelId,
          baseURL,
          protocol,
          apiKey: encryptedKey,
          keyProvider,
          contextWindow,
          supportsVision,
          supportsFiles,
          supportsReasoning,
        },
      })
    }

    // 返回带是否有 Key 信息的响应
    return NextResponse.json({
      ...buildCustomModelDefinition(record),
      dbId: record.id,
      hasApiKey: !!record.apiKey,
      keySource: record.apiKey ? "own" : record.keyProvider ? "provider" : "none",
      providerKey: record.keyProvider,
      modelId: record.modelId,
      baseURL: record.baseURL,
      protocol: record.protocol,
      updatedAt: record.updatedAt,
    })
  } catch (err) {
    console.error("[custom-model] Save error:", err)
    return NextResponse.json(
      { error: "保存失败：" + (err instanceof Error ? err.message : String(err)) },
      { status: 500 }
    )
  }
}
