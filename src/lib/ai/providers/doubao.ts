import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"

// 规格依据火山方舟官方模型列表(2026-09 核实)。
// 方舟 model id 带日期后缀,且每月新增快照;下表为 2026-09 时点值。
// doubao-pro / doubao-lite 一代已不在在售清单,已删除并登记别名。
export const doubaoProvider: ProviderDefinition = {
  id: "doubao",
  name: "字节豆包",
  models: [
    // ── 主力 ─────────────────────────────────────────────
    { id: "doubao-seed-2-1-pro-260915", name: "Doubao Seed 2.1 Pro", provider: "doubao", contextWindow: 1024000, supportsVision: true, supportsFiles: false, supportsReasoning: true },
    { id: "doubao-seed-2-1-lite-260915", name: "Doubao Seed 2.1 Lite", provider: "doubao", contextWindow: 256000, supportsVision: true, supportsFiles: false, supportsReasoning: true },
    { id: "doubao-seed-evolving", name: "Doubao Seed Evolving", provider: "doubao", contextWindow: 1024000, supportsVision: true, supportsFiles: false, supportsReasoning: true },
    // ── 旧版(默认折叠)────────────────────────────────────
    { id: "doubao-seed-2-1-turbo-260628", name: "Doubao Seed 2.1 Turbo", provider: "doubao", contextWindow: 256000, supportsVision: true, supportsFiles: false, supportsReasoning: true, tier: "legacy" },
    { id: "doubao-seed-2-1-pro-260628", name: "Doubao Seed 2.1 Pro (0628)", provider: "doubao", contextWindow: 256000, supportsVision: true, supportsFiles: false, supportsReasoning: true, tier: "legacy" },
  ],
  createProvider: (apiKey: string) => createOpenAI({
    apiKey,
    baseURL: "https://ark.cn-beijing.volces.com/api/v3"
  }),
}
