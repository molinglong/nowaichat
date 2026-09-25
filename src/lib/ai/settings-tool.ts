import { tool } from "ai"
import { z } from "zod"
import {
  SETTING_KEYS,
  SETTINGS_REGISTRY,
  getSettingDef,
  isAllowedValue,
  formatSettingValue,
  type SettingKey,
} from "@/lib/settings/registry"

/**
 * 应用设置控制工具（update_settings）
 *
 * 设计要点（与 web_search / ask_clarification 同一协议，见 ToolCallCard 扩展位注释）：
 * - 有 execute（区别于 clarify 的无 execute）：服务端白名单校验通过后立即返回 ok，
 *   模型拿到结果自然续写"已切换"话术；真正的设置变更由前端执行器
 *   （src/lib/settings/executor.ts）监听 tool part 完成，服务端不写任何设置。
 * - key 枚举由注册表（src/lib/settings/registry.ts）生成：注册表外的 key
 *   （含总开关 aiSettingsControl）对模型不存在，zod 校验直接拒绝。
 * - 总开关 aiSettingsControl 关闭时，本工具与快照段整体不注入（物理级关闭），
 *   改注入 SETTINGS_DISABLED_PROMPT 降级提示。
 */

export const SETTINGS_TOOL_NAME = "update_settings"

export const settingsInputSchema = z.object({
  operations: z
    .array(
      z.object({
        key: z.enum(SETTING_KEYS).describe("设置项，见工具描述中的白名单"),
        value: z
          .string()
          .max(60)
          .describe("目标值，必须是该设置项白名单内的取值"),
      })
    )
    .min(1)
    .max(4)
    .describe("1-4 条设置操作，支持一句话同时修改多项"),
})

export type SettingsToolInput = z.infer<typeof settingsInputSchema>

/** 工具描述中列出的白名单（模型决策依据，须与注册表一致） */
const TOOL_WHITELIST_TEXT = SETTINGS_REGISTRY.map(
  (d) => `- ${d.key}（${d.label}）: ${d.allowedValues.join(' / ')}`
).join("\n")

/**
 * 创建设置控制工具。execute 只做白名单兜底校验并返回确认：
 * 真正的设置变更在前端发生（见文件头注释）。
 */
export function createSettingsTool() {
  return tool({
    description:
      "修改本应用的设置。当用户要求你替他更改应用设置（主题、侧边栏、联网搜索引擎、" +
      "对话风格、面具，或打开某个设置页）时调用；一次可携带 1-4 条操作。\n" +
      "可用设置项与取值白名单：\n" +
      TOOL_WHITELIST_TEXT +
      "\n不要联网搜索，不要输出手动操作教程；询问当前设置状态时直接依据快照回答，不调用本工具。",
    inputSchema: settingsInputSchema,
    execute: async ({ operations }) => {
      // 服务端兜底校验：key 已被 zod 枚举拦住，这里再校验 value 白名单
      for (const op of operations) {
        if (!isAllowedValue(op.key, op.value)) {
          const def = getSettingDef(op.key)
          return {
            ok: false,
            error: `设置项 ${op.key} 不接受值 "${op.value}"，允许的值：${def?.allowedValues.join(" / ") ?? "无"}`,
          }
        }
      }
      return {
        ok: true,
        applied: operations.map((op) => `${getSettingDef(op.key)?.label ?? op.key} → ${formatSettingValue(op.key, op.value)}`),
      }
    },
  })
}

/**
 * 注入 system prompt 的使用规则段（分层思想同 CLARIFY_TOOL_PROMPT：
 * 外部问题正常回答；拿不准时走 ask_clarification；未列出的设置不承诺可改）。
 */
export const SETTINGS_TOOL_PROMPT: string = [
  "## 应用设置控制（update_settings 工具）",
  "- 用户要求\"你替他修改\"本应用设置（主题/侧边栏/联网搜索引擎/对话风格/面具，或打开某个设置页）时，调用 update_settings 直接执行；不要联网搜索，不要输出手动操作教程",
  "- 一次可携带 1-4 条操作（operations），支持一句话同时修改多项",
  "- 工具返回 ok 后用一句话向用户确认结果；返回 error 时如实告知原因，不要虚构已执行",
  "- 用户询问当前设置状态时，依据下方\"当前应用设置\"快照直接回答，不调用本工具",
  "- 用户问的是操作系统或其他软件的设置（如\"Windows 怎么开浅色模式\"）属于外部问题，正常回答",
  "- 意图拿不准（\"替我改\"还是\"教我怎么改\"）且会实质影响结果时，用 ask_clarification 问一句",
  "- API Key、自定义模型（custom: 前缀）、自定义生图模型不在本工具范围，被问到时告知需在设置中手动修改；服务商下模型的添加/移除/隐藏改用 manage_provider_models 工具，不要用本工具",
].join("\n")

/** 总开关关闭时的降级提示（工具不注入，仅靠这段避免模型输出教程/虚构执行） */
export const SETTINGS_DISABLED_PROMPT: string = [
  "## 应用设置控制（已关闭）",
  "本应用的 AI 设置控制功能已在 设置 → 通用 中关闭。用户请求修改应用设置或",
  "添加/移除服务商模型时，请如实告知该功能当前已关闭，可在设置中手动操作；",
  "不要联网搜索，不要输出操作教程，不要虚构执行结果。",
].join("\n")

/**
 * 服务端拼装"当前应用设置"快照段。
 * - 客户端设置项：来自请求 body.settingsSnapshot（executor.buildSettingsSnapshot 上报）
 * - DB 设置项（memory/clarify/imageModel/imageSize）：route 直查 User 表传入，
 *   不信任前端上报 —— 与手动开关/设置面板的写入路径保持一致
 */
export function buildSettingsSnapshotSection(
  snapshot: Partial<Record<SettingKey, string>> | undefined,
  dbValues: {
    memoryEnabled: boolean
    clarifyEnabled: boolean
    imageModel?: string
    imageSize?: string
  }
): string {
  // DB 项折算成注册表 value（on/off 及原生 id/尺寸），与客户端项同一渲染路径
  const dbSnapshot: Partial<Record<SettingKey, string>> = {
    memory: dbValues.memoryEnabled ? "on" : "off",
    clarify: dbValues.clarifyEnabled ? "on" : "off",
    ...(dbValues.imageModel ? { image_model: dbValues.imageModel } : {}),
    ...(dbValues.imageSize ? { image_size: dbValues.imageSize } : {}),
  }

  const lines: string[] = ["## 当前应用设置（update_settings 可读写）"]
  for (const def of SETTINGS_REGISTRY) {
    // 动作型设置（打开设置页）没有"当前值"，不进快照
    if (def.key === "open_settings") continue
    const raw = dbSnapshot[def.key] ?? snapshot?.[def.key]
    lines.push(
      raw
        ? `- ${def.label}：${formatSettingValue(def.key, raw)}`
        : `- ${def.label}：未知（以界面实际状态为准）`
    )
  }
  lines.push(
    "（以上为参考快照，可能与界面有细微延迟；快照未列出的设置项无法由 AI 修改）"
  )
  return lines.join("\n")
}
