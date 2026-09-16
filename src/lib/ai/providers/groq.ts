import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"

export const groqProvider: ProviderDefinition = {
  id: "groq",
  name: "Groq",
  models: [
    // Llama 3.3 系列
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", provider: "groq", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    // Llama 3.2 系列
    { id: "llama-3.2-1b-preview", name: "Llama 3.2 1B", provider: "groq", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "llama-3.2-3b-preview", name: "Llama 3.2 3B", provider: "groq", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "llama-3.2-11b-vision-preview", name: "Llama 3.2 11B Vision", provider: "groq", contextWindow: 131072, supportsVision: true, supportsFiles: false, supportsReasoning: false },
    { id: "llama-3.2-90b-vision-preview", name: "Llama 3.2 90B Vision", provider: "groq", contextWindow: 131072, supportsVision: true, supportsFiles: false, supportsReasoning: false },
    // Llama 3.1 系列
    { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", provider: "groq", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    // Mixtral
    { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", provider: "groq", contextWindow: 32768, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    // 其他
    { id: "deepseek-r1-distill-llama-70b", name: "DeepSeek R1 Distill 70B", provider: "groq", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: true },
  ],
  createProvider: (apiKey: string) => createOpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1"
  }),
}
