import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"

export const moonshotProvider: ProviderDefinition = {
  id: "moonshot",
  name: "Moonshot (Kimi)",
  models: [
    // Kimi 最新系列
    { id: "kimi-latest", name: "Kimi Latest", provider: "moonshot", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "kimi-k2-0905-preview", name: "Kimi K2", provider: "moonshot", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    // Moonshot V1 系列（不同上下文长度）
    { id: "moonshot-v1-8k", name: "Moonshot V1 8K", provider: "moonshot", contextWindow: 8000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "moonshot-v1-32k", name: "Moonshot V1 32K", provider: "moonshot", contextWindow: 32000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "moonshot-v1-128k", name: "Moonshot V1 128K", provider: "moonshot", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    // 视觉模型
    { id: "moonshot-v1-vision-preview", name: "Moonshot Vision", provider: "moonshot", contextWindow: 131072, supportsVision: true, supportsFiles: false, supportsReasoning: false },
  ],
  createProvider: (apiKey: string) => createOpenAI({
    apiKey,
    baseURL: "https://api.moonshot.cn/v1"
  }),
}
