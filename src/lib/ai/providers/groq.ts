import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"

// 规格依据 Groq 官方 Supported Models / Deprecations 页(2026-09 核实)。
// 主力已换成开源权重的 gpt-oss 系列;Llama 3.x / Mixtral / R1-distill 这些老条目
// Groq 官方已把 llama-3.1-8b / llama-3.3-70b 降为仅企业档。
// TODO(2026-09):legacy 条目是否仍可用普通 Key 调用未核实。核实方式:GET /openai/v1/models。
export const groqProvider: ProviderDefinition = {
  id: "groq",
  name: "Groq",
  models: [
    // ── 主力 ─────────────────────────────────────────────
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", provider: "groq", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: true },
    { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B", provider: "groq", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: true },
    { id: "qwen/qwen3.8-27b", name: "Qwen3.8 27B (Preview)", provider: "groq", contextWindow: 131042, supportsVision: true, supportsFiles: false, supportsReasoning: true },
    // ── 旧版(默认折叠)────────────────────────────────────
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", provider: "groq", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", provider: "groq", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "llama-3.2-1b-preview", name: "Llama 3.2 1B", provider: "groq", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "llama-3.2-3b-preview", name: "Llama 3.2 3B", provider: "groq", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "llama-3.2-11b-vision-preview", name: "Llama 3.2 11B Vision", provider: "groq", contextWindow: 131072, supportsVision: true, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "llama-3.2-90b-vision-preview", name: "Llama 3.2 90B Vision", provider: "groq", contextWindow: 131072, supportsVision: true, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", provider: "groq", contextWindow: 32768, supportsVision: false, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "deepseek-r1-distill-llama-70b", name: "DeepSeek R1 Distill 70B", provider: "groq", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: true, tier: "legacy" },
  ],
  createProvider: (apiKey: string) => createOpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1"
  }),
}
