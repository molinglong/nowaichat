import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { BUILTIN_MODELS, getBuiltinModel } from "@/lib/ai/image"
import { encrypt } from "@/lib/crypto"

const VALID_SIZES = ["1024*1024", "720*1280", "1280*720"]

// 内置模型的有效 ID 列表
const BUILTIN_IDS = BUILTIN_MODELS.map((m) => m.id)

/**
 * GET /api/image-settings
 * 返回: { settings, builtinModels, customModels }
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const [user, customModels] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { imageModel: true, imageSize: true },
    }),
    prisma.imageModel.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    }),
  ])

  return NextResponse.json({
    settings: {
      imageModel: user?.imageModel ?? "builtin:wanx2.1-t2i-turbo",
      imageSize: user?.imageSize ?? "1024*1024",
    },
    builtinModels: BUILTIN_MODELS,
    customModels: customModels.map((m) => ({
      id: `custom:${m.id}`,
      name: m.name,
      modelId: m.modelId,
      provider: "custom",
      baseURL: m.baseURL,
      supportsSize: m.supportsSize,
      apiKeySource: m.apiKeySource,
      keyProvider: m.keyProvider,
      contextWindow: m.contextWindow,
    })),
  })
}

/**
 * PATCH /api/image-settings
 * Body: {
 *   settings?: { imageModel?: string; imageSize?: string },
 *   customModel?: { action: "add"|"update"|"delete", ... }
 * }
 */
export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  let body: {
    settings?: { imageModel?: string; imageSize?: string }
    customModel?: {
      action: "add" | "update" | "delete"
      id?: string
      name?: string
      modelId?: string
      baseURL?: string
      apiKeySource?: string
      apiKey?: string
      keyProvider?: string
      supportsSize?: boolean
      contextWindow?: number
    }
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // ── 保存设置 ──────────────────────────────────────────────────────────────
  if (body.settings) {
    const data: { imageModel?: string; imageSize?: string } = {}

    if (body.settings.imageModel !== undefined) {
      // 验证: 内置或自定义
      const isBuiltin = BUILTIN_IDS.includes(body.settings.imageModel)
      const isCustom = body.settings.imageModel.startsWith("custom:")
      if (!isBuiltin && !isCustom) {
        return NextResponse.json(
          { error: `无效的模型 ID: ${body.settings.imageModel}` },
          { status: 400 }
        )
      }
      data.imageModel = body.settings.imageModel
    }

    if (body.settings.imageSize !== undefined) {
      if (!VALID_SIZES.includes(body.settings.imageSize)) {
        return NextResponse.json(
          { error: `无效的尺寸,可选: ${VALID_SIZES.join(", ")}` },
          { status: 400 }
        )
      }
      data.imageSize = body.settings.imageSize
    }

    if (Object.keys(data).length > 0) {
      await prisma.user.update({ where: { id: userId }, data })
    }
  }

  // ── 自定义模型 CRUD ──────────────────────────────────────────────────────
  if (body.customModel) {
    const { action, ...fields } = body.customModel

    if (action === "add") {
      if (!fields.name?.trim() || !fields.modelId?.trim() || !fields.baseURL?.trim()) {
        return NextResponse.json(
          { error: "名称、模型 ID 和 Base URL 为必填项" },
          { status: 400 }
        )
      }
      const existing = await prisma.imageModel.findUnique({
        where: { userId_modelId: { userId, modelId: fields.modelId.trim() } },
      })
      if (existing) {
        return NextResponse.json(
          { error: "已存在相同模型 ID 的自定义模型" },
          { status: 409 }
        )
      }
      const record = await prisma.imageModel.create({
        data: {
          userId,
          name: fields.name.trim(),
          modelId: fields.modelId.trim(),
          baseURL: fields.baseURL.trim(),
          apiKeySource: fields.apiKeySource ?? "provider",
          apiKey: fields.apiKey ? encrypt(fields.apiKey) : null,
          keyProvider: fields.keyProvider ?? null,
          supportsSize: fields.supportsSize ?? true,
          contextWindow: fields.contextWindow ?? 2048,
        },
      })
      return NextResponse.json({ success: true, id: `custom:${record.id}` })
    }

    if (action === "update") {
      if (!fields.id) return NextResponse.json({ error: "缺少模型 ID" }, { status: 400 })
      const dbId = fields.id.replace("custom:", "")
      const updateData: Record<string, unknown> = {}
      if (fields.name !== undefined) updateData.name = fields.name.trim()
      if (fields.modelId !== undefined) updateData.modelId = fields.modelId.trim()
      if (fields.baseURL !== undefined) updateData.baseURL = fields.baseURL.trim()
      if (fields.apiKeySource !== undefined) updateData.apiKeySource = fields.apiKeySource
      if (fields.apiKey !== undefined) updateData.apiKey = fields.apiKey ? encrypt(fields.apiKey) : null
      if (fields.keyProvider !== undefined) updateData.keyProvider = fields.keyProvider || null
      if (fields.supportsSize !== undefined) updateData.supportsSize = fields.supportsSize
      if (fields.contextWindow !== undefined) updateData.contextWindow = fields.contextWindow

      await prisma.imageModel.update({
        where: { id: dbId },
        data: updateData,
      })
      return NextResponse.json({ success: true })
    }

    if (action === "delete") {
      if (!fields.id) return NextResponse.json({ error: "缺少模型 ID" }, { status: 400 })
      const dbId = fields.id.replace("custom:", "")
      // 如果删除的是当前选中的模型，自动切回默认
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { imageModel: true },
      })
      if (user?.imageModel === `custom:${dbId}`) {
        await prisma.user.update({
          where: { id: userId },
          data: { imageModel: "builtin:wanx2.1-t2i-turbo" },
        })
      }
      await prisma.imageModel.delete({ where: { id: dbId } })
      return NextResponse.json({ success: true })
    }
  }

  return NextResponse.json({ success: true })
}
