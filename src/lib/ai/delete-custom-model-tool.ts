import { tool } from "ai"
import { z } from "zod"

/**
 * 删除自定义模型工具（delete_custom_model）
 *
 * 设计目标：用户说"把中转站 xxx 删了"/"删掉生图里的 xxx"时，模型产出结构化删除目标，
 * 前端渲染确认卡片（DeleteCustomModelCard），用户点击确认并通过计算题校验后才真正删除：
 * chat 走 DELETE /api/custom-models/[id]，image 走 PATCH /api/image-settings 的
 * customModel.action=delete（与设置面板手动操作同端点、同校验）。
 *
 * 与 manage_provider_models 的 remove 同一防护协议（无 execute + 卡片二次确认 + 计算题）：
 * 删除是破坏性操作，误触成本不对称，"直接执行"（update_settings 模式）已被明确否决。
 * tool call 输出后本轮即结束；服务端 onFinish 把 input 收进 metadata 持久化，
 * 历史回放走同一渲染分支——卡片按当前模型列表判断目标是否仍存在（终态判断），
 * 刷新/回放后按钮态仍正确，不持久化"已执行"标记。
 *
 * ⚠ 本文件禁止 import prisma 等服务端依赖（卡片组件直接 import）；
 * 两个自定义模型库的快照段见 custom-model-tool.server.ts。
 */

export const DELETE_CUSTOM_MODEL_TOOL_NAME = "delete_custom_model"

export const CUSTOM_MODEL_DELETE_SCOPES = ["chat", "image"] as const
export type CustomModelDeleteScope = (typeof CUSTOM_MODEL_DELETE_SCOPES)[number]

export const CUSTOM_MODEL_SCOPE_LABELS: Record<CustomModelDeleteScope, string> = {
  chat: "聊天自定义模型",
  image: "生图自定义模型",
}

export const customModelDeleteTargetSchema = z.object({
  scope: z
    .enum(CUSTOM_MODEL_DELETE_SCOPES)
    .describe(
      "要删除的模型所在库：chat=聊天/中转站自定义模型（设置→自定义模型），image=生图自定义模型（设置→生图）"
    ),
  modelId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe("要删除的模型 ID（API 调用名），必须取自下方对应清单，不是显示名"),
  name: z
    .string()
    .trim()
    .max(60)
    .optional()
    .describe("模型显示名（仅用于确认文案；能确定才传）"),
})

export const customModelDeleteInputSchema = z.object({
  targets: z
    .array(customModelDeleteTargetSchema)
    .min(1)
    .max(4)
    .describe("1-4 条删除目标；每条独立确认执行，目标必须来自下方已有模型清单"),
})

export type CustomModelDeleteTarget = z.infer<typeof customModelDeleteTargetSchema>
export type CustomModelDeleteInput = z.infer<typeof customModelDeleteInputSchema>

/** 从任意来源（tool part input / metadata toolCalls input）解析删除目标；
 *  非法项丢弃、按 scope+modelId 去重、最多 4 条（历史数据字段可能不全）。 */
export function toCustomModelDeleteTargets(input: unknown): CustomModelDeleteTarget[] {
  if (!input || typeof input !== "object") return []
  const raw = (input as { targets?: unknown }).targets
  if (!Array.isArray(raw)) return []
  const targets: CustomModelDeleteTarget[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const scope = r.scope
    if (!CUSTOM_MODEL_DELETE_SCOPES.includes(scope as CustomModelDeleteScope)) continue
    const modelId = typeof r.modelId === "string" ? r.modelId.trim() : ""
    if (!modelId) continue
    const key = `${scope}:${modelId}`
    if (seen.has(key)) continue
    seen.add(key)
    const target: CustomModelDeleteTarget = {
      scope: scope as CustomModelDeleteScope,
      modelId: modelId.slice(0, 100),
    }
    if (typeof r.name === "string" && r.name.trim()) target.name = r.name.trim().slice(0, 60)
    targets.push(target)
    if (targets.length >= 4) break
  }
  return targets
}

/** 目标的展示名：优先显示名，回退 modelId */
export function customModelDeleteLabel(target: CustomModelDeleteTarget): string {
  return target.name?.trim() || target.modelId
}

/** 操作的一句话描述（卡片每行 + 待确认文案复用） */
export function describeCustomModelDeleteTarget(target: CustomModelDeleteTarget): string {
  return `删除${CUSTOM_MODEL_SCOPE_LABELS[target.scope]}「${customModelDeleteLabel(target)}」`
}

/** 删除完成后的结果描述（完成态卡片 + toast 复用） */
export function describeCustomModelDeleteResult(target: CustomModelDeleteTarget): string {
  return `${CUSTOM_MODEL_SCOPE_LABELS[target.scope]}「${customModelDeleteLabel(target)}」已删除`
}

/**
 * 目标态是否已达成（历史回放/刷新后的"已执行"判断）：
 * 模型已不在对应库中 = 已完成（数据驱动，不依赖本地执行记录）。
 * presentIds：该 scope 当前模型 modelId 集合（卡片从列表查询构建）。
 */
export function isCustomModelDeleteSatisfied(
  target: CustomModelDeleteTarget,
  presentIds: ReadonlySet<string>
): boolean {
  return !presentIds.has(target.modelId)
}

/** 创建删除自定义模型工具（无 execute，见文件头注释） */
export function createDeleteCustomModelTool() {
  return tool({
    description:
      "删除用户的自定义模型（聊天中转站/自定义 API 模型，或生图自定义模型）。" +
      "用户要求「把某个中转站模型删掉」「删除自定义模型 xxx」「删掉生图里的模型 xxx」时调用。" +
      "删除不会立即生效：以确认卡片呈现，用户点击确认并答对计算题后才真正删除；" +
      "调用前必须先输出一句引入语（如「好的，我来准备删除…」），不要声称已完成。",
    inputSchema: customModelDeleteInputSchema,
  })
}

/** 注入 system prompt 的静态规则段（两个模型库的实时快照见 server 文件） */
export const DELETE_CUSTOM_MODEL_TOOL_PROMPT: string = [
  "## 删除自定义模型（delete_custom_model 工具）",
  "- 用户要求删除聊天中转站/自定义模型（设置→自定义模型）时 scope=chat；要求删除生图自定义模型（设置→生图）时 scope=image",
  "- modelId 必须取自下方「已有自定义模型——聊天」「已有生图自定义模型」清单；清单中没有的不要调用，如实说明未找到",
  "- 同一 modelId 可能同时存在于两个库：用户未指明且两库都有时，先用 ask_clarification 问清删哪个，不要擅自选择",
  "- 本工具只删自定义模型两库；服务商下添加的模型的删除改用 manage_provider_models 的 remove，内置聊天模型用 hide（以隐藏代替删除），内置生图模型不可删除（如实告知）",
  "- 删除是破坏性操作：卡片会要求用户二次确认并答对计算题才执行；调用前必须配一句引入语，不要声称「已删除」「已完成」（未生效）",
  "- 一次 1-4 条；目标不明确时先澄清，禁止凭显示名臆测 modelId",
].join("\n")
