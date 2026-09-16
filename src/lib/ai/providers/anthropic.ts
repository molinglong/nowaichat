import { createAnthropic } from "@ai-sdk/anthropic"
import { ProviderDefinition } from "../types"

export const anthropicProvider: ProviderDefinition = {
  id: "anthropic",
  name: "Anthropic",
  models: [
    // Claude 4 系列
    { id: "claude-opus-4-20250514", name: "Claude Opus 4", provider: "anthropic", contextWindow: 200000, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic", contextWindow: 200000, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    // Claude 3.7 Sonnet
    { id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet", provider: "anthropic", contextWindow: 200000, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    // Claude 3.5 系列
    { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", provider: "anthropic", contextWindow: 200000, supportsVision: true, supportsFiles: true, supportsReasoning: false },
    { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", provider: "anthropic", contextWindow: 200000, supportsVision: true, supportsFiles: false, supportsReasoning: false },
    // Claude 3 系列
    { id: "claude-3-opus-20240229", name: "Claude 3 Opus", provider: "anthropic", contextWindow: 200000, supportsVision: true, supportsFiles: true, supportsReasoning: false },
    { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku", provider: "anthropic", contextWindow: 200000, supportsVision: true, supportsFiles: false, supportsReasoning: false },
  ],
  createProvider: (apiKey: string) => createAnthropic({ apiKey }),
}
