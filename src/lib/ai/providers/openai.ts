import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"

// 规格依据 OpenAI 官方 Models / Pricing 页(2026-09 核实)。
// 主力已进入 GPT-5.x 世代:gpt-5.5 系列为旗舰,5.4 系列为性价比梯队。
// TODO(2026-09):旧世代(4o/4.1/4.5/o 系)已从官方定价页下架,但 API 是否仍可调用
// 未获官方确认,故暂留 legacy 分层(默认折叠)。核实方式:用 API Key 调 GET /v1/models,
// 若已不可用则删除条目并在 registry.ts 的 LEGACY_MODEL_ALIASES 登记映射。
export const openaiProvider: ProviderDefinition = {
  id: "openai",
  name: "OpenAI",
  models: [
    // ── 主力 ─────────────────────────────────────────────
    { id: "gpt-5.5", name: "GPT-5.5", provider: "openai", contextWindow: 1000000, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    // TODO(2026-09):上下文窗口官方未列出,暂按 1M
    { id: "gpt-5.5-pro", name: "GPT-5.5 Pro", provider: "openai", contextWindow: 1000000, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    { id: "gpt-5.4", name: "GPT-5.4", provider: "openai", contextWindow: 1050000, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    // TODO(2026-09):上下文窗口官方未列出,暂与 gpt-5.4 对齐
    { id: "gpt-5.4-pro", name: "GPT-5.4 Pro", provider: "openai", contextWindow: 1050000, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", provider: "openai", contextWindow: 400000, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    { id: "gpt-5.4-nano", name: "GPT-5.4 Nano", provider: "openai", contextWindow: 400000, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    // ── 旧版(默认折叠)────────────────────────────────────
    { id: "gpt-4o", name: "GPT-4o", provider: "openai", contextWindow: 128000, supportsVision: true, supportsFiles: true, supportsReasoning: false, tier: "legacy" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", contextWindow: 128000, supportsVision: true, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "gpt-4.1", name: "GPT-4.1", provider: "openai", contextWindow: 1047576, supportsVision: true, supportsFiles: true, supportsReasoning: false, tier: "legacy" },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "openai", contextWindow: 1047576, supportsVision: true, supportsFiles: true, supportsReasoning: false, tier: "legacy" },
    { id: "gpt-4.1-nano", name: "GPT-4.1 Nano", provider: "openai", contextWindow: 1047576, supportsVision: true, supportsFiles: true, supportsReasoning: false, tier: "legacy" },
    { id: "gpt-4.5-preview", name: "GPT-4.5 Preview", provider: "openai", contextWindow: 128000, supportsVision: true, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "o1", name: "o1", provider: "openai", contextWindow: 200000, supportsVision: false, supportsFiles: false, supportsReasoning: true, tier: "legacy" },
    { id: "o1-mini", name: "o1-mini", provider: "openai", contextWindow: 128000, supportsVision: false, supportsFiles: false, supportsReasoning: true, tier: "legacy" },
    { id: "o3", name: "o3", provider: "openai", contextWindow: 200000, supportsVision: true, supportsFiles: false, supportsReasoning: true, tier: "legacy" },
    { id: "o3-mini", name: "o3-mini", provider: "openai", contextWindow: 200000, supportsVision: false, supportsFiles: false, supportsReasoning: true, tier: "legacy" },
    { id: "o4-mini", name: "o4-mini", provider: "openai", contextWindow: 200000, supportsVision: true, supportsFiles: false, supportsReasoning: true, tier: "legacy" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo", provider: "openai", contextWindow: 128000, supportsVision: true, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo", provider: "openai", contextWindow: 16385, supportsVision: false, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
  ],
  createProvider: (apiKey: string) => createOpenAI({ apiKey }),
}
