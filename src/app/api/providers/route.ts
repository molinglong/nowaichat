import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { providers, getEffectiveModels } from "@/lib/ai/registry"

/**
 * GET /api/providers
 * 返回服务商列表及其模型信息。
 * - 静态字段（id、name、原始 models id 列表）始终基于内置硬编码。
 * - `effectiveModels` 字段基于当前用户的覆盖（隐藏 + 添加）计算。
 *
 * 注：早期版本未鉴权（静态元数据），改造后改为需要登录，
 * 因为 effectiveModels 是用户级数据，且前端使用同一接口渲染模型选择器。
 */
export async function GET(_req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const effectiveModels = await getEffectiveModels(userId)

  const list = Object.values(providers).map((p) => {
    const builtinModelIds = p.models.map((m) => m.id)
    const effective = effectiveModels.filter((m) => m.provider === p.id)
    return {
      id: p.id,
      name: p.name,
      models: builtinModelIds,
      // 当前用户可见的模型（含该 provider 下的内置 + 用户添加）
      effectiveModels: effective.map((m) => ({
        id: m.id,
        name: m.name,
        contextWindow: m.contextWindow,
        supportsVision: m.supportsVision,
        supportsFiles: m.supportsFiles,
        supportsReasoning: m.supportsReasoning,
      })),
    }
  })

  return NextResponse.json(list)
}
