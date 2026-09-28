import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"

// 规格依据百度千帆官方模型列表(2026-09 核实)。
// ERNIE 5.1 为纯文本旗舰、不带深度思考;ERNIE 5.0 为原生全模态(含思维链)。
// ERNIE 4.0 / 3.5 / Speed / Tiny 已不在在售清单,已删除并在 registry.ts 登记别名。
export const wenxinProvider: ProviderDefinition = {
  id: "wenxin",
  name: "文心一言",
  models: [
    // ── 主力 ─────────────────────────────────────────────
    { id: "ernie-5.1", name: "ERNIE 5.1", provider: "wenxin", contextWindow: 128000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "ernie-5.0", name: "ERNIE 5.0", provider: "wenxin", contextWindow: 128000, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    // ── 旧版(默认折叠)────────────────────────────────────
    { id: "ernie-4.5-turbo-128k", name: "ERNIE 4.5 Turbo 128K", provider: "wenxin", contextWindow: 128000, supportsVision: false, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "ernie-4.5-turbo-vl", name: "ERNIE 4.5 Turbo VL", provider: "wenxin", contextWindow: 128000, supportsVision: true, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
  ],
  createProvider: (apiKey: string) => createOpenAI({
    apiKey,
    baseURL: "https://qianfan.baidubce.com/v2"
  }),
}
