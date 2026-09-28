import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"

// ⚠️ TODO(2026-09):本家清单**未完成核实**。
// Mistral 官方文档站是客户端渲染(SPA),抓不到 model 字段的精确 id 字符串;
// 官方 deprecations 表确认「型号」在售(mistral-large-3 / medium-3.5 / small-4 等),
// 但 API id 未能逐字核对。下方保留的 `-latest` 是滚动别名,通常始终指向当前主力版本,
// 因此暂不改动。核实方式:用 API Key 调 GET https://api.mistral.ai/v1/models,
// 拿到真实 id 后替换本清单,并把已废弃的旧代 id 登记到 registry.ts 的 LEGACY_MODEL_ALIASES。
export const mistralProvider: ProviderDefinition = {
  id: "mistral",
  name: "Mistral",
  models: [
    // Mistral 系列(滚动别名,指向当前主力)
    { id: "mistral-large-latest", name: "Mistral Large", provider: "mistral", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "mistral-medium-latest", name: "Mistral Medium", provider: "mistral", contextWindow: 32000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "mistral-small-latest", name: "Mistral Small", provider: "mistral", contextWindow: 32000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "open-mistral-nemo", name: "Mistral Nemo", provider: "mistral", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    // 代码与视觉模型
    { id: "codestral-latest", name: "Codestral", provider: "mistral", contextWindow: 256000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "pixtral-large-latest", name: "Pixtral Large", provider: "mistral", contextWindow: 131072, supportsVision: true, supportsFiles: false, supportsReasoning: false },
    { id: "pixtral-12b-2409", name: "Pixtral 12B", provider: "mistral", contextWindow: 131072, supportsVision: true, supportsFiles: false, supportsReasoning: false },
  ],
  createProvider: (apiKey: string) => createOpenAI({
    apiKey,
    baseURL: "https://api.mistral.ai/v1"
  }),
}
