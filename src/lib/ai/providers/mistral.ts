import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"

export const mistralProvider: ProviderDefinition = {
  id: "mistral",
  name: "Mistral",
  models: [
    // Mistral 系列
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
