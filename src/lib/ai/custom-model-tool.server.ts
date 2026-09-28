import { prisma } from "@/lib/db"
import { ADD_CUSTOM_MODEL_TOOL_PROMPT } from "@/lib/ai/custom-model-tool"

/**
 * add_custom_model 的注入段拼装（服务端专用，依赖 prisma；拆分原因见
 * provider-model-tool.server.ts 头注释：常量与规则段在 isomorphic 文件里，
 * 卡片组件可直接 import 而不把 pg 打进客户端 bundle）。
 *
 * 段结构 = 静态规则段 + 用户已有自定义模型快照（仅名称/端点/modelId）。
 * 刻意不读 apiKey：Key 对模型不可见，也不需要在上下文里出现。
 */
export async function buildCustomModelSection(userId: string): Promise<string> {
  const rows = await prisma.customModel.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { name: true, modelId: true, baseURL: true },
  })

  const lines: string[] = [
    ADD_CUSTOM_MODEL_TOOL_PROMPT,
    "",
    "已有自定义模型（modelId 唯一，重复添加会被拒绝）：",
  ]
  if (rows.length === 0) {
    lines.push("- 无（尚未添加任何自定义模型）")
  } else {
    for (const r of rows) {
      lines.push(`- ${r.name} / ${r.modelId}（${r.baseURL}）`)
    }
  }
  lines.push("（只列出名称与端点；API Key 由用户在卡片里填写，对模型不可见）")
  return lines.join("\n")
}
