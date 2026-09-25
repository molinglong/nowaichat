import { prisma } from "@/lib/db"
import { providers } from "@/lib/ai/registry"
import { PROVIDER_MODEL_TOOL_RULES } from "@/lib/ai/provider-model-tool"

/**
 * manage_provider_models 的注入段拼装（服务端专用，依赖 prisma/registry；
 * 常量与规则段在 provider-model-tool.ts（isomorphic），拆分原因见该文件头注释）。
 *
 * 段结构 = 静态规则段（isomorphic 来源）
 *        + 可用服务商白名单（registry 权威，避免 prompt 里手抄清单漂移）
 *        + 用户当前已添加/已隐藏的模型快照（实时查库，供模型判断终态与去重）
 */

/** 可用服务商白名单文本（provider id + 中文名，registry 单一数据源） */
function buildProviderCatalogLines(): string[] {
  return Object.values(providers).map((p) => `- ${p.id}：${p.name}`)
}

/**
 * 服务商模型管理注入段。用户已添加的模型通常只有个位数，直接全量列出；
 * 内置模型清单不逐条列出（太长），需要判断 hide/unhide 内置性时由卡片
 * 依据 /api/provider-models 返回的 builtinCatalog 兜底。
 */
export async function buildProviderModelSection(userId: string): Promise<string> {
  const rows = await prisma.providerModelOverride.findMany({
    where: { userId },
    orderBy: [{ provider: "asc" }, { modelId: "asc" }],
    select: { provider: true, modelId: true, name: true, isHidden: true },
  })

  const added = rows.filter((r) => !r.isHidden)
  const hidden = rows.filter((r) => r.isHidden)

  const lines: string[] = [
    PROVIDER_MODEL_TOOL_RULES,
    "",
    "可用服务商（provider 白名单，只能用这些 id）：",
    ...buildProviderCatalogLines(),
    "",
    "当前用户已调整的模型：",
  ]

  if (added.length === 0 && hidden.length === 0) {
    lines.push("- 无（尚未添加或隐藏任何模型）")
  } else {
    for (const r of added) {
      lines.push(`- 已添加：${r.provider} / ${r.modelId}（显示名 ${r.name}）`)
    }
    for (const r of hidden) {
      lines.push(`- 已隐藏（内置）：${r.provider} / ${r.modelId}`)
    }
  }

  lines.push(
    "（以上快照可能与界面有细微延迟；不在服务商白名单内的 provider 无法操作）"
  )
  return lines.join("\n")
}
