import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { providers } from "@/lib/ai/registry"

/**
 * GET /api/provider-models
 * 返回当前用户的所有预置模型覆盖记录。
 *
 * 响应字段：
 *   - providerOverrides[]: 用户级 ProviderModelOverride 行（用于设置页面渲染管理 UI）
 *   - builtinCatalog: 全部内置模型目录（来自 registry，不带用户上下文），供前端按 provider 分组渲染
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const rows = await prisma.providerModelOverride.findMany({
    where: { userId },
    orderBy: [{ provider: "asc" }, { modelId: "asc" }],
  })

  return NextResponse.json({
    providerOverrides: rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      modelId: r.modelId,
      isHidden: r.isHidden,
      name: r.name,
      contextWindow: r.contextWindow,
      supportsVision: r.supportsVision,
      supportsFiles: r.supportsFiles,
      supportsReasoning: r.supportsReasoning,
      updatedAt: r.updatedAt,
    })),
    // 内置模型目录（registry 权威）：前端用它判断 hide/unhide 的目标是否为内置模型
    builtinCatalog: Object.values(providers).map((p) => ({
      id: p.id,
      name: p.name,
      models: p.models.map((m) => m.id),
    })),
  })
}

/**
 * POST /api/provider-models
 * 创建或更新一条 ProviderModelOverride。
 *
 * Body 字段：
 *   - id?: 现有记录 id（更新时必填；创建时省略）
 *   - provider: provider id（必填）
 *   - modelId: 模型 ID（必填）
 *   - isHidden: boolean，true=隐藏预置模型 / false=用户添加的新模型
 *   - name: 显示名（新增时必填；隐藏时可填空串）
 *   - contextWindow / supportsVision / supportsFiles / supportsReasoning: 能力配置（仅 isHidden=false 时生效）
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const body = await req.json().catch(() => ({}))
  const {
    id,
    provider,
    modelId,
    isHidden = false,
    name,
    contextWindow = 32768,
    supportsVision = false,
    supportsFiles = false,
    supportsReasoning = false,
  } = body

  if (!provider || !modelId) {
    return NextResponse.json(
      { error: "provider 和 modelId 是必填项" },
      { status: 400 }
    )
  }
  // provider 白名单（registry 单一数据源）：拦住 AI/脚本幻觉出的 provider id，
  // 避免脏覆盖记录进入 effectiveModels 计算链路
  if (!providers[provider]) {
    return NextResponse.json(
      { error: `未知服务商 "${provider}"，可用：${Object.keys(providers).join(" / ")}` },
      { status: 400 }
    )
  }
  if (!isHidden && (!name || !name.trim())) {
    return NextResponse.json(
      { error: "新增模型时 name 是必填项" },
      { status: 400 }
    )
  }

  try {
    let record
    if (id) {
      // 更新
      const existing = await prisma.providerModelOverride.findFirst({
        where: { id, userId },
      })
      if (!existing) {
        return NextResponse.json({ error: "记录不存在" }, { status: 404 })
      }
      record = await prisma.providerModelOverride.update({
        where: { id },
        data: {
          provider,
          modelId,
          isHidden,
          name: isHidden ? "" : name,
          contextWindow,
          supportsVision,
          supportsFiles,
          supportsReasoning,
        },
      })
    } else {
      // 创建（如果有冲突会抛错 → Prisma P2002）
      record = await prisma.providerModelOverride.create({
        data: {
          userId,
          provider,
          modelId,
          isHidden,
          name: isHidden ? "" : name,
          contextWindow,
          supportsVision,
          supportsFiles,
          supportsReasoning,
        },
      })
    }

    return NextResponse.json({
      id: record.id,
      provider: record.provider,
      modelId: record.modelId,
      isHidden: record.isHidden,
      name: record.name,
      contextWindow: record.contextWindow,
      supportsVision: record.supportsVision,
      supportsFiles: record.supportsFiles,
      supportsReasoning: record.supportsReasoning,
      updatedAt: record.updatedAt,
    })
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "该 provider 下已存在相同 modelId 的覆盖记录" },
        { status: 409 }
      )
    }
    console.error("[provider-models] Save error:", err)
    return NextResponse.json(
      { error: "保存失败：" + (err instanceof Error ? err.message : String(err)) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/provider-models?id=xxx
 * 删除一条覆盖记录（取消隐藏 / 删除用户新增的模型）。
 */
export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "缺少 id 参数" }, { status: 400 })
  }

  const existing = await prisma.providerModelOverride.findFirst({
    where: { id, userId },
  })
  if (!existing) {
    return NextResponse.json({ error: "记录不存在" }, { status: 404 })
  }

  await prisma.providerModelOverride.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
