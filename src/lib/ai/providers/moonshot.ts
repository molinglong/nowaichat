import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"

// 规格依据 Kimi 开放平台官方模型列表(2026-09 核实)。
// moonshot-v1 全系、kimi-latest、kimi-k2-0905-preview 均已下线,已删除并登记别名。
// TODO(2026-09):K3/K2.6 的「文件输入」官方口径是独立的文件抽取接口,不是 chat 内挂载,
// 故 supportsFiles 按 false 处理;kimi-k2.7-code 的推理开关未逐项核实。
export const moonshotProvider: ProviderDefinition = {
  id: "moonshot",
  name: "Moonshot (Kimi)",
  models: [
    // ── 主力 ─────────────────────────────────────────────
    { id: "kimi-k3", name: "Kimi K3", provider: "moonshot", contextWindow: 1048576, supportsVision: true, supportsFiles: false, supportsReasoning: true },
    { id: "kimi-k2.6", name: "Kimi K2.6", provider: "moonshot", contextWindow: 262144, supportsVision: true, supportsFiles: false, supportsReasoning: true },
    // ── 专项 / 旧版(默认折叠)──────────────────────────────
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", provider: "moonshot", contextWindow: 262144, supportsVision: false, supportsFiles: false, supportsReasoning: true, tier: "legacy" },
    { id: "kimi-k2.7-code-highspeed", name: "Kimi K2.7 Code HighSpeed", provider: "moonshot", contextWindow: 262144, supportsVision: false, supportsFiles: false, supportsReasoning: true, tier: "legacy" },
  ],
  createProvider: (apiKey: string) => createOpenAI({
    apiKey,
    baseURL: "https://api.moonshot.cn/v1"
  }),
}
