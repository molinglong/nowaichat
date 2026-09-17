import { tool } from "ai"
import { z } from "zod"
import type { MaskFewShotTurn } from "@/lib/ai/mask-types"

/**
 * 面具工坊工具（generate_mask）
 *
 * 设计目标：用户要求"创建/设计一个面具"时，模型生成面具草稿（人格指令包），
 * 前端渲染为预览卡片，用户确认后一键入库为自定义面具。
 *
 * 与 add_memory 的关键差异：不自动落库 —— 面具是"用户身份资产"，草稿需要
 * 用户把关（预览 → 一键添加），所以同样无 execute（同 ask_clarification 模式），
 * tool call 输出后本轮流即结束；服务端 onFinish 照常把 input 收进
 * metadata.toolCalls 持久化，历史回放走同一渲染分支（卡片仍可添加）。
 *
 * 值限制与 maskInputSchema（POST /api/masks 的服务端校验）严格对齐：
 * 草稿提交走同一端点、同一校验，不会有第二种入库规则。
 * 本文件纯常量无服务端依赖，客户端组件可安全 import。
 */

export const MASK_TOOL_NAME = "generate_mask"

/** AI 生成面具草稿的 schema（值限制与 mask-types.maskInputSchema 对齐 + describe 指引） */
export const maskGeneratorSchema = z.object({
  name: z.string().trim().min(1).max(30).describe("面具名称，简短有辨识度，最多 30 字"),
  avatar: z.string().min(1).max(4).describe("头像，单个贴切的 emoji，如 🧑‍🍳"),
  description: z.string().trim().min(1).max(50).describe("一句话定位，显示在选择器卡片副标题，最多 50 字"),
  systemPrompt: z
    .string()
    .trim()
    .min(1)
    .max(8000)
    .describe(
      "人格指令全文：可直接使用的第一人称人格段落，含身份、行为规则、输出格式与边界，" +
        "质量对齐内置面具（见快照段）。系统会统一追加逃生舱规则，不要自己写「直答：」相关内容"
    ),
  fewShot: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2000),
      })
    )
    .max(8)
    .optional()
    .describe("可选的 2-4 轮预设对话示例，锚定交互格式（输出结构、追问节奏）；任务型面具建议提供"),
  stylePreset: z
    .string()
    .max(20)
    .nullable()
    .optional()
    .describe(
      "可选：该面具默认对话风格，仅当用户明确要求某种语气时传（balanced/practical/dev/editor/mentor/scholar），否则不传"
    ),
})

export type MaskGeneratorInput = z.infer<typeof maskGeneratorSchema>

/** 前端渲染用的草稿形状（历史 metadata 里 input 可能缺字段，逐字段兜底） */
export interface MaskDraftView {
  name: string
  avatar: string
  description: string
  systemPrompt: string
  fewShot: MaskFewShotTurn[]
  stylePreset: string | null
}

/** 从任意来源（tool part input / metadata toolCalls input）提取草稿；核心字段缺失返回 null */
export function toMaskDraft(input: unknown): MaskDraftView | null {
  if (!input || typeof input !== "object") return null
  const raw = input as Record<string, unknown>
  const name = typeof raw.name === "string" ? raw.name.trim() : ""
  const systemPrompt = typeof raw.systemPrompt === "string" ? raw.systemPrompt.trim() : ""
  if (!name || !systemPrompt) return null
  const avatar = typeof raw.avatar === "string" && raw.avatar.trim() ? raw.avatar.trim() : "🎭"
  const description = typeof raw.description === "string" ? raw.description.trim() : ""
  const fewShot: MaskFewShotTurn[] = Array.isArray(raw.fewShot)
    ? raw.fewShot
        .map((t) => {
          if (!t || typeof t !== "object") return null
          const role = (t as { role?: unknown }).role
          const content = (t as { content?: unknown }).content
          if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim())
            return null
          return { role, content } as MaskFewShotTurn
        })
        .filter((t): t is MaskFewShotTurn => t !== null)
    : []
  const stylePreset = typeof raw.stylePreset === "string" && raw.stylePreset.trim() ? raw.stylePreset.trim() : null
  return { name, avatar, description, systemPrompt, fewShot, stylePreset }
}

/** 创建面具工坊工具（无 execute，见文件头注释） */
export function createMaskGeneratorTool() {
  return tool({
    description:
      "生成一个面具草稿（人格指令包：头像+名称+定位+人格指令+对话示例），以预览卡片呈现给用户，" +
      "用户确认后一键保存为自定义面具。当用户要求创建/设计/生成面具或某类人格助手时调用；" +
      "用户只是想切换到已有面具时不要调用本工具（那应使用 update_settings 的 mask 项）。",
    inputSchema: maskGeneratorSchema,
  })
}

/** 注入 system prompt 的使用规则段 */
export const MASK_TOOL_PROMPT: string = [
  "## 面具工坊（generate_mask 工具）",
  "- 用户要求创建/设计/生成一个面具（某种人格的助手）时，调用本工具产出草稿；调用时正文最多一句引入语",
  "- systemPrompt 必须是拿来即用的第一人称人格段落：身份、行为规则、输出格式、边界都要写全，质量对齐下方快照中的内置面具；逃生舱规则由系统统一追加，不要自己写「直答：」",
  "- 任务型面具（翻译、周报、浓缩等强输出格式）建议附 2-4 轮 fewShot 锚定交互格式；闲聊陪伴型可不附",
  "- avatar 用单个贴切 emoji；description 一句话说清定位；用户明确要求某种语气风格时才传 stylePreset",
  "- 用户对生成结果提出修改意见时，按意见重新调用本工具生成修订版草稿",
].join("\n")
