import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"

export const openaiProvider: ProviderDefinition = {
  id: "openai",
  name: "OpenAI",
  models: [
    // GPT-4o 系列
    { id: "gpt-4o", name: "GPT-4o", provider: "openai", contextWindow: 128000, supportsVision: true, supportsFiles: true, supportsReasoning: false },
    { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", contextWindow: 128000, supportsVision: true, supportsFiles: false, supportsReasoning: false },
    // GPT-4.1 系列
    { id: "gpt-4.1", name: "GPT-4.1", provider: "openai", contextWindow: 1047576, supportsVision: true, supportsFiles: true, supportsReasoning: false },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "openai", contextWindow: 1047576, supportsVision: true, supportsFiles: true, supportsReasoning: false },
    { id: "gpt-4.1-nano", name: "GPT-4.1 Nano", provider: "openai", contextWindow: 1047576, supportsVision: true, supportsFiles: true, supportsReasoning: false },
    // GPT-4.5
    { id: "gpt-4.5-preview", name: "GPT-4.5 Preview", provider: "openai", contextWindow: 128000, supportsVision: true, supportsFiles: false, supportsReasoning: false },
    // o 系列推理模型
    { id: "o1", name: "o1", provider: "openai", contextWindow: 200000, supportsVision: false, supportsFiles: false, supportsReasoning: true },
    { id: "o1-mini", name: "o1-mini", provider: "openai", contextWindow: 128000, supportsVision: false, supportsFiles: false, supportsReasoning: true },
    { id: "o3", name: "o3", provider: "openai", contextWindow: 200000, supportsVision: true, supportsFiles: false, supportsReasoning: true },
    { id: "o3-mini", name: "o3-mini", provider: "openai", contextWindow: 200000, supportsVision: false, supportsFiles: false, supportsReasoning: true },
    { id: "o4-mini", name: "o4-mini", provider: "openai", contextWindow: 200000, supportsVision: true, supportsFiles: false, supportsReasoning: true },
    // 经典模型
    { id: "gpt-4-turbo", name: "GPT-4 Turbo", provider: "openai", contextWindow: 128000, supportsVision: true, supportsFiles: false, supportsReasoning: false },
    { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo", provider: "openai", contextWindow: 16385, supportsVision: false, supportsFiles: false, supportsReasoning: false },
  ],
  createProvider: (apiKey: string) => createOpenAI({ apiKey }),
}
