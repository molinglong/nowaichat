import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"

export const doubaoProvider: ProviderDefinition = {
  id: "doubao",
  name: "字节豆包",
  models: [
    // 豆包 Pro 系列
    { id: "doubao-pro-32k", name: "Doubao Pro 32K", provider: "doubao", contextWindow: 32000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "doubao-pro-256k", name: "Doubao Pro 256K", provider: "doubao", contextWindow: 256000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    // 豆包 Lite 系列
    { id: "doubao-lite-32k", name: "Doubao Lite 32K", provider: "doubao", contextWindow: 32000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "doubao-lite-128k", name: "Doubao Lite 128K", provider: "doubao", contextWindow: 128000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    // 视觉模型
    { id: "doubao-vision-pro-32k", name: "Doubao Vision Pro", provider: "doubao", contextWindow: 32000, supportsVision: true, supportsFiles: false, supportsReasoning: false },
  ],
  createProvider: (apiKey: string) => createOpenAI({
    apiKey,
    baseURL: "https://ark.cn-beijing.volces.com/api/v3"
  }),
}
