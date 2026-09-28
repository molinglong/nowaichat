import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"

// 规格依据 xAI 官方 Models / Pricing 页(2026-09 核实)。
// 别名规则:<modelname> = 最新稳定版,<modelname>-latest = 最新版,<modelname>-<date> = 固定版本。
// TODO(2026-09):grok-3 / grok-2 / grok-beta 已不在官方定价页出现,但未找到官方下架公告,
// 故暂留 legacy 分层(默认折叠)。核实方式:用 API Key 调 GET /v1/models。
export const xaiProvider: ProviderDefinition = {
  id: "xai",
  name: "xAI Grok",
  models: [
    // ── 主力 ─────────────────────────────────────────────
    { id: "grok-4.7", name: "Grok 4.7", provider: "xai", contextWindow: 500000, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    // ── 旧版(默认折叠)────────────────────────────────────
    { id: "grok-4.6", name: "Grok 4.6", provider: "xai", contextWindow: 500000, supportsVision: true, supportsFiles: true, supportsReasoning: true, tier: "legacy" },
    { id: "grok-4.5", name: "Grok 4.5", provider: "xai", contextWindow: 500000, supportsVision: true, supportsFiles: true, supportsReasoning: true, tier: "legacy" },
    { id: "grok-4.3", name: "Grok 4.3", provider: "xai", contextWindow: 1000000, supportsVision: true, supportsFiles: true, supportsReasoning: true, tier: "legacy" },
    { id: "grok-4.20-0309-reasoning", name: "Grok 4.20 Reasoning", provider: "xai", contextWindow: 1000000, supportsVision: true, supportsFiles: true, supportsReasoning: true, tier: "legacy" },
    { id: "grok-4.20-0309-non-reasoning", name: "Grok 4.20 Non-reasoning", provider: "xai", contextWindow: 1000000, supportsVision: true, supportsFiles: true, supportsReasoning: false, tier: "legacy" },
    { id: "grok-4.20-multi-agent-0309", name: "Grok 4.20 Multi-Agent", provider: "xai", contextWindow: 1000000, supportsVision: true, supportsFiles: true, supportsReasoning: true, tier: "legacy" },
    { id: "grok-3", name: "Grok 3", provider: "xai", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "grok-3-mini", name: "Grok 3 Mini", provider: "xai", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: true, tier: "legacy" },
    { id: "grok-2-1212", name: "Grok 2", provider: "xai", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "grok-2-vision-1212", name: "Grok 2 Vision", provider: "xai", contextWindow: 32768, supportsVision: true, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "grok-beta", name: "Grok Beta", provider: "xai", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "grok-vision-beta", name: "Grok Vision Beta", provider: "xai", contextWindow: 32768, supportsVision: true, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
  ],
  createProvider: (apiKey: string) => createOpenAI({
    apiKey,
    baseURL: "https://api.x.ai/v1"
  }),
}
