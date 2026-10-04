import { tool } from "ai"
import { z } from "zod"

/**
 * 中转站/自定义模型工具（add_custom_model）
 *
 * 设计目标：用户说"加个中转站 https://ai.soulecho.cc/v1，模型 gpt-5.6-sol"时，
 * 模型产出结构化草稿，前端渲染确认卡片（AddCustomModelCard）——用户在卡片里
 * 粘贴 API Key、点「测试并保存」后才真正入库（POST /api/custom-models，加密存储）。
 *
 * ⚠ API Key 刻意不进工具参数：schema 里没有 apiKey 字段，模型既看不到也传不了 Key；
 * Key 只从卡片输入框直达服务端（测试与保存各一次请求体），不经模型 API、不进聊天记录。
 * 这是 write_document / generate_mask「草稿-确认」协议的安全变体：涉及凭据的写入，
 * AI 只能起草"往哪连、连哪个模型"，最终提交权与 Key 始终在用户手上。
 *
 * 无 execute（同 mask-tool.ts 头注释）：tool call 输出后本轮即结束；服务端 onFinish 把
 * input 收进 metadata 持久化，历史回放走同一渲染分支——卡片按当前自定义模型列表
 * 判断"已存在"（modelId 唯一约束），刷新/回放后按钮态仍正确。
 *
 * ⚠ 本文件禁止 import prisma 等服务端依赖（卡片组件直接 import）；
 * 用户自定义模型快照段见 custom-model-tool.server.ts。
 */

export const ADD_CUSTOM_MODEL_TOOL_NAME = "add_custom_model"

export const CUSTOM_MODEL_PROTOCOLS = ["auto", "chat", "responses", "anthropic"] as const
export type CustomModelProtocol = (typeof CUSTOM_MODEL_PROTOCOLS)[number]

export const customModelDraftSchema = z.object({
  name: z
    .string()
    .trim()
    .max(40)
    .optional()
    .describe("显示名（如「SoulEcho 中转」）；省略则按域名自动生成"),
  baseURL: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      "OpenAI 兼容端点，通常以 /v1 结尾，如 https://ai.soulecho.cc/v1；本地服务可为 http://localhost:11434/v1"
    ),
  modelId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe("API 调用模型名（如 gpt-5.6-sol），不是显示名"),
  protocol: z
    .enum(CUSTOM_MODEL_PROTOCOLS)
    .optional()
    .describe("协议，默认 auto；仅当用户明确说端点走 Anthropic/Responses 协议时才填"),
  contextWindow: z
    .number()
    .int()
    .min(1000)
    .max(10_000_000)
    .optional()
    .describe("上下文窗口 token 数；不确定就省略（默认 32768）"),
})

export type CustomModelDraftInput = z.infer<typeof customModelDraftSchema>

/** 前端渲染用的草稿形状（历史 metadata 里 input 可能缺字段，逐字段兜底） */
export interface CustomModelDraftView {
  name: string
  baseURL: string
  modelId: string
  protocol: CustomModelProtocol
  contextWindow: number
}

export const DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW = 32768

/** baseURL 规范化：去尾斜杠 + 必须是 http(s) 且可解析（挡模型幻觉与历史脏数据） */
function normalizeBaseURL(raw: string): string | null {
  const value = raw.trim().replace(/\/+$/, "")
  if (!/^https?:\/\//i.test(value)) return null
  try {
    return new URL(value).host ? value : null
  } catch {
    return null
  }
}

/** 从 baseURL 推导默认显示名（域名去 www） */
function nameFromBaseURL(baseURL: string): string {
  try {
    return new URL(baseURL).hostname.replace(/^www\./, "")
  } catch {
    return baseURL
  }
}

/**
 * 从任意来源（tool part input / metadata toolCalls input）解析草稿；
 * 核心字段（baseURL/modelId）缺失或非法返回 null（卡片显示"配置不完整"）。
 */
export function toCustomModelDraft(input: unknown): CustomModelDraftView | null {
  if (!input || typeof input !== "object") return null
  const raw = input as Record<string, unknown>
  const baseURL = typeof raw.baseURL === "string" ? normalizeBaseURL(raw.baseURL) : null
  const modelId = typeof raw.modelId === "string" ? raw.modelId.trim() : ""
  if (!baseURL || !modelId) return null
  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim().slice(0, 40)
      : nameFromBaseURL(baseURL)
  const protocol = CUSTOM_MODEL_PROTOCOLS.includes(raw.protocol as CustomModelProtocol)
    ? (raw.protocol as CustomModelProtocol)
    : "auto"
  const contextWindow =
    typeof raw.contextWindow === "number" &&
    Number.isFinite(raw.contextWindow) &&
    raw.contextWindow >= 1000
      ? Math.min(Math.floor(raw.contextWindow), 10_000_000)
      : DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW
  return { name, baseURL, modelId, protocol, contextWindow }
}

/** 创建中转站/自定义模型草稿工具（无 execute，见文件头注释） */
export function createCustomModelTool() {
  return tool({
    description:
      "起草一个自定义模型（中转站/自定义 API 端点上的模型）配置，以确认卡片呈现给用户：" +
      "用户在卡片里粘贴 API Key 并点「测试并保存」后才真正生效。当用户要求「加一个中转站」" +
      "「加个自定义模型/接口」并给出 base URL（或域名）与模型名时调用。\n" +
      "注意：不要传 API Key——Key 由用户在卡片里粘贴，你不需要也无法接收它；" +
      "不要声称「已添加」，一句引入语后发起调用即可。",
    inputSchema: customModelDraftSchema,
  })
}

/** 草稿终态判断：同 modelId 的自定义模型已存在（唯一约束 [userId, modelId]） */
export function isCustomModelDraftSatisfied(
  modelId: string,
  existing: ReadonlyArray<{ modelId?: string | null }>
): boolean {
  return !!modelId && existing.some((m) => m.modelId === modelId)
}

/** 注入 system prompt 的静态规则段（已有自定义模型快照见 server 文件） */
export const ADD_CUSTOM_MODEL_TOOL_PROMPT: string = [
  "## 中转站/自定义模型（add_custom_model 工具）",
  "- 用户要求「加一个中转站 / 中转 API / 自定义端点 / 自定义模型」并给出地址（或域名）+ 模型名时调用本工具；一次只处理一个模型",
  "- baseURL 必须是 http:// 或 https:// 开头的完整端点；用户只给域名（如 ai.example.com）时按 https://<域名>/v1 补全；本地服务保留 http://localhost 形式",
  "- 参数只传 name / baseURL / modelId / protocol / contextWindow；**绝对不要把 API Key（sk- 开头等）写进工具参数** —— Key 由用户在确认卡片里亲手粘贴，你看不到也不需要它",
  "- 用户没给 Key 时说明「在卡片里粘贴 Key 后点测试并保存」；操作要等用户确认才生效，引入语不要说「已添加」「已完成」",
  "- 用户只给了 Key 没给地址时，用 ask_clarification 问清 base URL 与模型名（Key 不要写进提问）",
  "- 本工具只负责新增；用户要修改已有自定义模型的 Key/地址/名称时，让用户到 设置 → 自定义模型 编辑；删除已有自定义模型改用 delete_custom_model 工具",
  "- 调用前先核对下方「已有自定义模型——聊天」清单：modelId 已存在时不要重复调用，正文说明它已在列表中并询问是否还要别的操作",
].join("\n")
