import { prisma } from "@/lib/db"
import { ADD_CUSTOM_MODEL_TOOL_PROMPT } from "@/lib/ai/custom-model-tool"
import { DELETE_CUSTOM_MODEL_TOOL_PROMPT } from "@/lib/ai/delete-custom-model-tool"

/**
 * 自定义模型工具的注入段拼装（服务端专用，依赖 prisma；拆分原因见
 * provider-model-tool.server.ts 头注释：常量与规则段在 isomorphic 文件里，
 * 卡片组件可直接 import 而不把 pg 打进客户端 bundle）。
 *
 * 段结构 = add 规则段 + delete 规则段（isomorphic 来源）
 *        + 聊天自定义模型快照（add 查重 / delete 目标校验共用）
 *        + 生图自定义模型快照（delete 目标校验用）
 * 刻意不读 apiKey：Key 对模型不可见，也不需要在上下文里出现。
 */
export async function buildCustomModelSection(userId: string): Promise<string> {
  const [chatRows, imageRows] = await Promise.all([
    prisma.customModel.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { name: true, modelId: true, baseURL: true },
    }),
    prisma.imageModel.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { name: true, modelId: true, baseURL: true },
    }),
  ])

  const lines: string[] = [
    ADD_CUSTOM_MODEL_TOOL_PROMPT,
    "",
    DELETE_CUSTOM_MODEL_TOOL_PROMPT,
    "",
    "已有自定义模型——聊天（modelId 唯一，重复添加会被拒绝；delete_custom_model 的合法目标）：",
  ]
  if (chatRows.length === 0) {
    lines.push("- 无（尚未添加任何聊天自定义模型）")
  } else {
    for (const r of chatRows) {
      lines.push(`- ${r.name} / ${r.modelId}（${r.baseURL}）`)
    }
  }

  lines.push("", "已有生图自定义模型（delete_custom_model 的合法目标）：")
  if (imageRows.length === 0) {
    lines.push("- 无（尚未添加任何生图自定义模型）")
  } else {
    for (const r of imageRows) {
      lines.push(`- ${r.name} / ${r.modelId}（${r.baseURL}）`)
    }
  }

  lines.push("（只列出名称与端点；API Key 由用户在卡片里填写，对模型不可见）")
  return lines.join("\n")
}
