import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { encrypt } from "@/lib/crypto"
import { buildCustomModelDefinition } from "@/lib/ai/custom-model"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const userId = session.user.id

  const body = await req.json()
  const {
    name,
    modelId,
    baseURL,
    protocol,
    apiKey,
    keyProvider,
    contextWindow,
    supportsVision,
    supportsFiles,
    supportsReasoning,
  } = body

  // 验证必填项（更新时可选，但最好有）
  if (name && !modelId) {
    return NextResponse.json(
      { error: "模型 ID 是必填项" },
      { status: 400 }
    )
  }

  try {
    // 先检查是否存在且属于该用户
    const existing = await prisma.customModel.findFirst({
      where: { id, userId },
    })
    if (!existing) {
      return NextResponse.json({ error: "模型不存在" }, { status: 404 })
    }

    // 构建更新对象（仅包含提供的字段）
    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (modelId !== undefined) updateData.modelId = modelId
    if (baseURL !== undefined) updateData.baseURL = baseURL
    if (protocol !== undefined) updateData.protocol = protocol
    if (apiKey !== undefined) {
      // 如果提供非空 API Key 则加密存储；否则不修改或清空
      if (apiKey.trim() !== "") {
        updateData.apiKey = encrypt(apiKey)
      } else {
        // 清空 Key：设为 null
        updateData.apiKey = null
      }
    }
    if (keyProvider !== undefined) updateData.keyProvider = keyProvider
    if (contextWindow !== undefined) updateData.contextWindow = contextWindow
    if (supportsVision !== undefined) updateData.supportsVision = supportsVision
    if (supportsFiles !== undefined) updateData.supportsFiles = supportsFiles
    if (supportsReasoning !== undefined) updateData.supportsReasoning = supportsReasoning

    const record = await prisma.customModel.update({
      where: { id },
      data: updateData,
    })

    const hasApiKey = !!record.apiKey
    return NextResponse.json({
      ...buildCustomModelDefinition(record),
      hasApiKey,
      protocol: record.protocol,
      keySource: record.apiKey ? "own" : record.keyProvider || "none",
      provider: record.keyProvider,
    })
  } catch (err) {
    console.error("[custom-model] Update error:", err)
    return NextResponse.json(
      { error: "更新失败：" + (err instanceof Error ? err.message : String(err)) },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const userId = session.user.id

  try {
    await prisma.customModel.deleteMany({
      where: { id, userId },
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[custom-model] Delete error:", err)
    return NextResponse.json(
      { error: "删除失败" },
      { status: 500 }
    )
  }
}
