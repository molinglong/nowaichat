import { createAnthropic } from "@ai-sdk/anthropic"
import { ProviderDefinition } from "../types"

// 规格依据 Anthropic 官方 Models overview / Model deprecations(2026-09 核实)。
// 命名规则:4.6 代起「无日期 id 也是固定快照」(claude-sonnet-4-6),4.5 及更早用带日期 id。
// Claude 4 / 3.x 已于 2026-06-15 退市,已从清单删除并在 registry.ts 登记别名。
// TODO(2026-09):4.5 / 4.6 世代的上下文窗口官方总览页未逐条列出,暂按 200K。
export const anthropicProvider: ProviderDefinition = {
  id: "anthropic",
  name: "Anthropic",
  models: [
    // ── 主力 ─────────────────────────────────────────────
    { id: "claude-opus-4-7", name: "Claude Opus 4.7", provider: "anthropic", contextWindow: 1000000, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", contextWindow: 1000000, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic", contextWindow: 200000, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    // ── 旧版(默认折叠)────────────────────────────────────
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic", contextWindow: 200000, supportsVision: true, supportsFiles: true, supportsReasoning: true, tier: "legacy" },
    { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5", provider: "anthropic", contextWindow: 200000, supportsVision: true, supportsFiles: true, supportsReasoning: true, tier: "legacy" },
    { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", provider: "anthropic", contextWindow: 200000, supportsVision: true, supportsFiles: true, supportsReasoning: true, tier: "legacy" },
    { id: "claude-opus-4-1-20250805", name: "Claude Opus 4.1", provider: "anthropic", contextWindow: 200000, supportsVision: true, supportsFiles: true, supportsReasoning: true, tier: "legacy" },
  ],
  createProvider: (apiKey: string) => createAnthropic({ apiKey }),
}
