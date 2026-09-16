import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"

export const yiProvider: ProviderDefinition = {
  id: "yi",
  name: "零一万物 Yi",
  models: [
    { id: "yi-large", name: "Yi Large", provider: "yi", contextWindow: 32768, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "yi-medium", name: "Yi Medium", provider: "yi", contextWindow: 16384, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "yi-small", name: "Yi Small", provider: "yi", contextWindow: 16384, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "yi-lightning", name: "Yi Lightning", provider: "yi", contextWindow: 16384, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "yi-vision", name: "Yi Vision", provider: "yi", contextWindow: 16384, supportsVision: true, supportsFiles: false, supportsReasoning: false },
  ],
  createProvider: (apiKey: string) => createOpenAI({
    apiKey,
    baseURL: "https://api.lingyiwanwu.com/v1"
  }),
}
