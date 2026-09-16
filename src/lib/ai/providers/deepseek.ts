import { createDeepSeek } from "@ai-sdk/deepseek"
import { ProviderDefinition } from "../types"

export const deepseekProvider: ProviderDefinition = {
  id: "deepseek",
  name: "DeepSeek",
  models: [
    { id: "deepseek-chat", name: "DeepSeek-V3", provider: "deepseek", contextWindow: 128000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "deepseek-reasoner", name: "DeepSeek-R1", provider: "deepseek", contextWindow: 128000, supportsVision: false, supportsFiles: false, supportsReasoning: true },
    { id: "deepseek-coder", name: "DeepSeek Coder V2", provider: "deepseek", contextWindow: 128000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
  ],
  createProvider: (apiKey: string) => createDeepSeek({
    apiKey,
    baseURL: "https://api.deepseek.com",
  }),
}
