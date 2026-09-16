import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"

export const qianwenProvider: ProviderDefinition = {
  id: "qianwen",
  name: "通义千问",
  models: [
    // 通义千问主力模型
    { id: "qwen-max", name: "Qwen Max", provider: "qianwen", contextWindow: 32000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "qwen-plus", name: "Qwen Plus", provider: "qianwen", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "qwen-turbo", name: "Qwen Turbo", provider: "qianwen", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "qwen-long", name: "Qwen Long", provider: "qianwen", contextWindow: 10000000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    // 视觉模型
    { id: "qwen-vl-max", name: "Qwen VL Max", provider: "qianwen", contextWindow: 32000, supportsVision: true, supportsFiles: false, supportsReasoning: false },
    { id: "qwen-vl-plus", name: "Qwen VL Plus", provider: "qianwen", contextWindow: 32000, supportsVision: true, supportsFiles: false, supportsReasoning: false },
    // Qwen 2.5 开源系列
    { id: "qwen2.5-72b-instruct", name: "Qwen2.5-72B", provider: "qianwen", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "qwen2.5-32b-instruct", name: "Qwen2.5-32B", provider: "qianwen", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "qwen2.5-14b-instruct", name: "Qwen2.5-14B", provider: "qianwen", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "qwen2.5-7b-instruct", name: "Qwen2.5-7B", provider: "qianwen", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "qwen2.5-coder-32b-instruct", name: "Qwen2.5 Coder-32B", provider: "qianwen", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    // 推理模型
    { id: "qwq-32b-preview", name: "QwQ-32B", provider: "qianwen", contextWindow: 131072, supportsVision: false, supportsFiles: false, supportsReasoning: true },
  ],
  createProvider: (apiKey: string) => {
    const openai = createOpenAI({
      apiKey,
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    })
    // DashScope 兼容模式的 /responses 端点对部分模型名支持不全(如 qwen-max
    // 报 "Unsupported model"),统一走 Chat Completions 端点
    return (modelId: string) => openai.chat(modelId)
  },
}
