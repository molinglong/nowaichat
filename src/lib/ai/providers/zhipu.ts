import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"

export const zhipuProvider: ProviderDefinition = {
  id: "zhipu",
  name: "智谱 GLM",
  models: [
    // GLM-4 系列
    { id: "glm-4-plus", name: "GLM-4 Plus", provider: "zhipu", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "glm-4", name: "GLM-4", provider: "zhipu", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "glm-4-flash", name: "GLM-4 Flash", provider: "zhipu", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "glm-4-flashx", name: "GLM-4 FlashX", provider: "zhipu", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "glm-4-air", name: "GLM-4 Air", provider: "zhipu", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "glm-4-long", name: "GLM-4 Long", provider: "zhipu", contextWindow: 1048576, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    // 视觉模型
    { id: "glm-4v", name: "GLM-4V", provider: "zhipu", contextWindow: 131072, supportsVision: true, supportsFiles: false, supportsReasoning: false },
  ],
  createProvider: (apiKey: string) => createOpenAI({
    apiKey,
    baseURL: "https://open.bigmodel.cn/api/paas/v4"
  }),
}
