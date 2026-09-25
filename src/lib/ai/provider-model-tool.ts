import { tool } from "ai"
import { z } from "zod"
import { PROVIDER_NAMES } from "@/lib/ai/provider-meta"

/**
 * 服务商模型管理工具（manage_provider_models）
 *
 * 设计目标：用户说"添加新模型 qwen3.6-flash 到通义千问"时，模型产出结构化操作，
 * 前端渲染确认卡片（ProviderModelCard），用户点击确认后才真正写入
 * /api/provider-models（与设置面板手动操作同端点、同校验），不自动落库。
 *
 * 与 generate_mask 同协议（无 execute，理由见 mask-tool.ts 头注释）：
 * tool call 输出后本轮即结束；服务端 onFinish 把 input 收进 metadata 持久化，
 * 历史回放走同一渲染分支——卡片按当前 overrides 的终态判断"已执行"，
 * 刷新/回放后按钮态仍正确，不需要额外的执行记录。
 *
 * 删除类操作（remove）在卡片上带两层防护：二次确认按钮 + 1-100 计算题，
 * 答对才发删除请求（防误触，不防攻击——“操作者就是本人”场景）。
 *
 * ⚠ 本文件禁止 import registry/prisma 等服务端依赖（卡片组件直接 import；
 * registry 连 pg 会打进客户端 bundle 报 fs 错误）。服务商白名单文本与
 * 用户模型快照段见 provider-model-tool.server.ts。
 */

export const PROVIDER_MODEL_TOOL_NAME = "manage_provider_models"

export const PROVIDER_MODEL_ACTIONS = ["add", "remove", "hide", "unhide"] as const
export type ProviderModelAction = (typeof PROVIDER_MODEL_ACTIONS)[number]

export const providerModelOpSchema = z.object({
  action: z
    .enum(PROVIDER_MODEL_ACTIONS)
    .describe("add=添加模型 remove=移除已添加的模型 hide=隐藏内置模型 unhide=恢复被隐藏的内置模型"),
  provider: z
    .string()
    .min(1)
    .max(40)
    .describe("服务商英文 id（如 qianwen），必须取自下方可用服务商列表，不要用中文名"),
  modelId: z
    .string()
    .min(1)
    .max(100)
    .describe("模型 ID（API 调用名，如 qwen3.6-flash），不是显示名"),
  name: z.string().max(60).optional().describe("显示名（仅 add 用；省略则用 modelId）"),
  contextWindow: z
    .number()
    .int()
    .min(1000)
    .max(10_000_000)
    .optional()
    .describe("上下文窗口 token 数（仅 add；能确定才传）"),
  supportsVision: z.boolean().optional().describe("是否支持读图（仅 add；能确定才传）"),
  supportsFiles: z.boolean().optional().describe("是否支持文件（仅 add；能确定才传）"),
  supportsReasoning: z.boolean().optional().describe("是否支持思考链（仅 add；能确定才传）"),
})

export const providerModelInputSchema = z.object({
  operations: z
    .array(providerModelOpSchema)
    .min(1)
    .max(4)
    .describe("1-4 条模型操作；移除（remove）必须单独一条，不要与其他操作合并"),
})

export type ProviderModelOp = z.infer<typeof providerModelOpSchema>
export type ProviderModelToolInput = z.infer<typeof providerModelInputSchema>

/** 创建服务商模型管理工具（无 execute，见文件头注释） */
export function createProviderModelTool() {
  return tool({
    description:
      "管理服务商（provider）下的模型列表：把新模型添加到某服务商、移除已添加的模型、" +
      "隐藏/恢复内置模型。用户说「添加新模型 xxx 到某服务商」「把某个模型从服务商里删掉」" +
      "「隐藏/恢复某个内置模型」时调用。调用前必须先输出一句引入语" +
      "（如「好的，我来准备把 qwen3.6-flash 添加到通义千问」），再发起工具调用；" +
      "只发工具调用、正文为空是错误行为。操作以确认卡片呈现，用户点击确认后才真正生效，" +
      "引入语不要声称已完成。",
    inputSchema: providerModelInputSchema,
  })
}

/**
 * 从任意来源（tool part input / metadata toolCalls input）解析操作列表；
 * 逐字段兜底，非法项丢弃（历史数据字段可能不全）。空数组表示卡片不可用。
 */
export function toProviderModelOps(input: unknown): ProviderModelOp[] {
  if (!input || typeof input !== "object") return []
  const raw = (input as { operations?: unknown }).operations
  if (!Array.isArray(raw)) return []
  const ops: ProviderModelOp[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const action = r.action
    if (!PROVIDER_MODEL_ACTIONS.includes(action as ProviderModelAction)) continue
    const provider = typeof r.provider === "string" ? r.provider.trim() : ""
    const modelId = typeof r.modelId === "string" ? r.modelId.trim() : ""
    if (!provider || !modelId) continue
    const op: ProviderModelOp = { action: action as ProviderModelAction, provider, modelId }
    if (typeof r.name === "string" && r.name.trim()) op.name = r.name.trim().slice(0, 60)
    if (typeof r.contextWindow === "number" && Number.isFinite(r.contextWindow)) {
      op.contextWindow = Math.floor(r.contextWindow)
    }
    if (typeof r.supportsVision === "boolean") op.supportsVision = r.supportsVision
    if (typeof r.supportsFiles === "boolean") op.supportsFiles = r.supportsFiles
    if (typeof r.supportsReasoning === "boolean") op.supportsReasoning = r.supportsReasoning
    ops.push(op)
    if (ops.length >= 4) break
  }
  return ops
}

/** 服务商中文显示名（未知 id 原样返回） */
export function providerDisplayName(providerId: string): string {
  return PROVIDER_NAMES[providerId] ?? providerId
}

export const PROVIDER_MODEL_ACTION_LABELS: Record<ProviderModelAction, string> = {
  add: "添加",
  remove: "移除",
  hide: "隐藏",
  unhide: "恢复",
}

/** 操作的中文一句话描述（卡片每行 + 完成态 toast 复用） */
export function describeProviderModelOp(op: ProviderModelOp): string {
  const provider = providerDisplayName(op.provider)
  const label = op.name?.trim() || op.modelId
  switch (op.action) {
    case "add":
      return `添加「${label}」到 ${provider}`
    case "remove":
      return `移除「${label}」（${provider}）`
    case "hide":
      return `隐藏内置模型「${label}」（${provider}）`
    case "unhide":
      return `恢复内置模型「${label}」（${provider}）`
  }
}

/** 操作完成后的结果描述（完成态卡片 + toast 复用，结果导向而非动作导向）
 *  add 用"已在"而非"已添加到"：目标可能本就在列表里（卡片不区分"刚添加"与"早就有"） */
export function describeProviderModelOpResult(op: ProviderModelOp): string {
  const provider = providerDisplayName(op.provider)
  const label = op.name?.trim() || op.modelId
  switch (op.action) {
    case "add":
      return `「${label}」已在 ${provider} 中`
    case "remove":
      return `「${label}」已从 ${provider} 移除`
    case "hide":
      return `内置模型「${label}」已隐藏（${provider}）`
    case "unhide":
      return `「${label}」已恢复（${provider}）`
  }
}

/** 覆盖记录最小形状（ProviderModelOverride 子集，卡片与判断函数共用） */
export interface ProviderOverrideLike {
  provider: string
  modelId: string
  isHidden: boolean
}

/**
 * 操作的目标态是否已达成（用于历史回放/刷新后的"已执行"判断）：
 * 依据当前覆盖记录的终态推断，而非本地执行记录——刷新后按钮态依然正确。
 * builtinModelIds：该 provider 的内置模型 id 集合（可选，卡片传
 * /api/provider-models 的 builtinCatalog 对应集合）——add 时用于识别
 * "目标本就内置"，避免对已存在模型重复要求确认；缺省则只查覆盖记录。
 */
export function isProviderModelOpSatisfied(
  op: ProviderModelOp,
  rows: ProviderOverrideLike[],
  builtinModelIds?: Set<string>
): boolean {
  const row = rows.find((r) => r.provider === op.provider && r.modelId === op.modelId)
  switch (op.action) {
    case "add":
      // 已添加且可见（覆盖记录），或本就内置且无覆盖记录（未隐藏）→ 视为已存在
      if (row && !row.isHidden) return true
      return !row && !!builtinModelIds?.has(op.modelId)
    case "remove":
      // 用户模型记录不存在（或被隐藏视为已下架）
      return !row || row.isHidden
    case "hide":
      return !!row && row.isHidden
    case "unhide":
      return !row || !row.isHidden
  }
}

/**
 * 注入 system prompt 的静态规则段（服务商白名单由 server 文件动态追加）。
 * 与 SETTINGS_TOOL_PROMPT 同一分层：未列出的能力不承诺，拿不准先澄清。
 */
export const PROVIDER_MODEL_TOOL_RULES: string = [
  "## 服务商模型管理（manage_provider_models 工具）",
  '- 用户要求给某个服务商添加/移除/隐藏模型（如"添加新模型 qwen3.6-flash 到通义千问"）时调用本工具，不要联网搜索，不要输出手动操作教程',
  "- provider 必须用可用服务商列表里的英文 id（如 qianwen），不要用中文名；modelId 是 API 调用名，不是显示名",
  "- 用户没说加到哪个服务商时：能从模型名可靠推断就推断（qwen→qianwen、deepseek→deepseek、glm→zhipu、kimi→moonshot），否则先用 ask_clarification 问一句",
  "- add：name 省略则用 modelId；知道该模型的视觉/思考/上下文规格就一并传入，不确定则省略（系统按模型名自动判断）",
  "- remove 只用于移除用户添加的模型，且必须单独调用（不要与其他操作合并）；hide/unhide 只用于内置模型",
  '- 每次调用都必须配一句引入语：先输出如"好的，我来准备把 qwen3.6-flash 添加到通义千问"这样的一句话再发起工具调用，禁止只发工具调用、正文为空',
  '- 操作不会立即生效：卡片会让用户确认（移除还需答对一道计算题），引入语不要声称已完成（不说"已添加""已完成"）；卡片标注不可执行时如实说明原因，不要虚构结果',
  '- 调用前先核对"当前用户已调整的模型"快照：目标模型已在清单中（或本次对话里刚添加过）时，禁止再生成 add 操作，正文直接说明它已在列表里并询问是否还需要其他操作',
  "- 服务商未配置 API Key 时模型添加后仍无法调用，可在正文提醒用户到 设置 → 服务商 配置 Key",
].join("\n")
