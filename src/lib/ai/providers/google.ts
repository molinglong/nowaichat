import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { ProviderDefinition } from "../types"

// 规格依据 Google Gemini API Models 文档(2026-09 核实)。
// 注意:当前没有稳定的 Gemini 3 Pro 端点,Pro 档只有 preview 版本。
// Gemini 2.0 系已关停、1.5 系与 gemini-3-pro-preview 已下线,均已删除并登记别名。
// TODO(2026-09):3.x 中间版本(3.5/3.6/3.7)的上下文与输出上限官方未逐条核实,暂按 1M。
export const googleProvider: ProviderDefinition = {
  id: "google",
  name: "Google Gemini",
  models: [
    // ── 主力 ─────────────────────────────────────────────
    { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", provider: "google", contextWindow: 1048576, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview)", provider: "google", contextWindow: 1048576, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", provider: "google", contextWindow: 1048576, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", provider: "google", contextWindow: 1048576, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    // ── 旧版(默认折叠)────────────────────────────────────
    { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", provider: "google", contextWindow: 1048576, supportsVision: true, supportsFiles: true, supportsReasoning: true, tier: "legacy" },
    { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", provider: "google", contextWindow: 1048576, supportsVision: true, supportsFiles: true, supportsReasoning: true, tier: "legacy" },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite", provider: "google", contextWindow: 1048576, supportsVision: true, supportsFiles: true, supportsReasoning: true, tier: "legacy" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash (Preview)", provider: "google", contextWindow: 1048576, supportsVision: true, supportsFiles: true, supportsReasoning: true, tier: "legacy" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google", contextWindow: 1048576, supportsVision: true, supportsFiles: true, supportsReasoning: true, tier: "legacy" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google", contextWindow: 1048576, supportsVision: true, supportsFiles: true, supportsReasoning: true, tier: "legacy" },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite", provider: "google", contextWindow: 1048576, supportsVision: true, supportsFiles: true, supportsReasoning: true, tier: "legacy" },
  ],
  createProvider: (apiKey: string) => createGoogleGenerativeAI({ apiKey }),
}
