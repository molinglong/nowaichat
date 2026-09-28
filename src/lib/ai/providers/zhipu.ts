import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"

// 规格依据智谱官方「模型概览」文档(2026-09 核实)。
// 注意:glm-5.3 是纯文本旗舰且思考恒开(thinking.type 仅 enabled);
// 只有 glm-5.3-flash / glm-5.3-flashx 支持图像/视频/文件输入。
// TODO(2026-09):glm-5v-turbo 的上下文窗口官方概览页未列明,暂按 200K;
// GLM-4 全系是否仍在 API 枚举内未核实,故留 legacy 分层(默认折叠)。
export const zhipuProvider: ProviderDefinition = {
  id: "zhipu",
  name: "智谱 GLM",
  models: [
    // ── 主力 ─────────────────────────────────────────────
    { id: "glm-5.3", name: "GLM-5.3", provider: "zhipu", contextWindow: 1000000, supportsVision: false, supportsFiles: false, supportsReasoning: true },
    { id: "glm-5.3-flash", name: "GLM-5.3 Flash", provider: "zhipu", contextWindow: 1000000, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    { id: "glm-5.3-flashx", name: "GLM-5.3 FlashX", provider: "zhipu", contextWindow: 1000000, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    { id: "glm-5.2", name: "GLM-5.2", provider: "zhipu", contextWindow: 1000000, supportsVision: false, supportsFiles: false, supportsReasoning: true },
    { id: "glm-5.1", name: "GLM-5.1", provider: "zhipu", contextWindow: 200000, supportsVision: false, supportsFiles: false, supportsReasoning: true },
    { id: "glm-5v-turbo", name: "GLM-5V Turbo", provider: "zhipu", contextWindow: 200000, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    // ── 旧版(默认折叠)────────────────────────────────────
    { id: "glm-4.7", name: "GLM-4.7", provider: "zhipu", contextWindow: 200000, supportsVision: false, supportsFiles: false, supportsReasoning: true, tier: "legacy" },
    { id: "glm-4.7-flash", name: "GLM-4.7 Flash", provider: "zhipu", contextWindow: 200000, supportsVision: false, supportsFiles: false, supportsReasoning: true, tier: "legacy" },
    { id: "glm-4-plus", name: "GLM-4 Plus", provider: "zhipu", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "glm-4", name: "GLM-4", provider: "zhipu", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "glm-4-flash", name: "GLM-4 Flash", provider: "zhipu", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "glm-4-flashx", name: "GLM-4 FlashX", provider: "zhipu", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "glm-4-air", name: "GLM-4 Air", provider: "zhipu", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "glm-4-long", name: "GLM-4 Long", provider: "zhipu", contextWindow: 1048576, supportsVision: false, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
    { id: "glm-4v", name: "GLM-4V", provider: "zhipu", contextWindow: 131072, supportsVision: true, supportsFiles: false, supportsReasoning: false, tier: "legacy" },
  ],
  createProvider: (apiKey: string) => createOpenAI({
    apiKey,
    baseURL: "https://open.bigmodel.cn/api/paas/v4"
  }),
}
