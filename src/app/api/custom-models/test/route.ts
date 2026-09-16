import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  resolveApiKey,
  createCustomLanguageModel,
  testCustomModelConnection,
  detectCustomModelCapabilities,
  type CustomModelRow,
} from "@/lib/ai/custom-model"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { id, detectCapabilities } = body

  const userId = session.user.id
  let cmRecord: CustomModelRow

  try {
    if (id) {
      // 测试已保存的模型
      const saved = await prisma.customModel.findFirst({
        where: { id, userId },
      })
      if (!saved) {
        return NextResponse.json({ error: "模型不存在" }, { status: 404 })
      }
      cmRecord = saved
    } else {
      // 测试未保存的字段（直接来自表单）
      const { name, modelId, baseURL, protocol, apiKey, keyProvider } = body
      if (!modelId) {
        return NextResponse.json({ error: "模型 ID 是必填项" }, { status: 400 })
      }
      if (!baseURL && !keyProvider) {
        return NextResponse.json(
          { error: "Base URL 必填（复用服务商 Key 时可留空）" },
          { status: 400 }
        )
      }
      // 模拟构建 CustomModelRow，无需数据库
      cmRecord = {
        id: "test",
        userId,
        name: name || "",
        modelId,
        baseURL: baseURL || "",
        protocol: protocol || "auto",
        apiKey: apiKey || null,
        keyProvider: keyProvider || null,
        contextWindow: 32768,
        supportsVision: false,
        supportsFiles: false,
        supportsReasoning: false,
      }
    }

    const result = await testCustomModelConnection(userId, cmRecord)
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 502 }
      )
    }

    // 连接成功 → 如有请求则额外检测能力
    let capabilities: Awaited<ReturnType<typeof detectCustomModelCapabilities>> | undefined
    if (detectCapabilities) {
      try {
        capabilities = await detectCustomModelCapabilities(userId, cmRecord)
      } catch (err) {
        console.error("[custom-model] Capability detection error:", err)
        // 忽略检测错误，不影响连接测试结果
      }
    }

    return NextResponse.json({ ok: true, capabilities })
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误"
    const details = err && typeof err === "object" && "responseBody" in err
      ? String(err.responseBody)
      : undefined
    const statusCode = err && typeof err === "object" && "statusCode" in err
      ? Number(err.statusCode)
      : undefined
    const error = details && !message.includes(details) ? `${message}: ${details}` : message
    console.error("[custom-model] Test error:", err)
    return NextResponse.json(
      { ok: false, error },
      { status: statusCode && statusCode >= 400 && statusCode < 600 ? statusCode : 502 }
    )
  }
}
