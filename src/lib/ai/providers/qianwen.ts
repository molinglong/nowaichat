import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"
import { createReasoningAwareFetch } from "../openai-reasoning-adapter"

// 模型规格依据百炼模型文档(2026-09 实测):
// - qwen3.8 系列:多模态(Image/Text/Video 输入),1M 上下文,思考/非思考融合,默认开启思考
// - qwen3.7-plus:纯文本,1M 上下文(账号免费额度耗尽时调用返回 403 FreeTierOnly)
export const qianwenProvider: ProviderDefinition = {
  id: "qianwen",
  name: "通义千问",
  models: [
    { id: "qwen3.8-flash", name: "Qwen3.8 Flash", provider: "qianwen", contextWindow: 1000000, supportsVision: true, supportsFiles: false, supportsReasoning: true },
    { id: "qwen3.8-max", name: "Qwen3.8 Max", provider: "qianwen", contextWindow: 1000000, supportsVision: true, supportsFiles: false, supportsReasoning: true },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus", provider: "qianwen", contextWindow: 1000000, supportsVision: false, supportsFiles: false, supportsReasoning: true },
  ],
  createProvider: (apiKey: string) => {
    const openai = createOpenAI({
      apiKey,
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      // DashScope 兼容模式的 /responses 端点对部分模型名支持不全(报
      // "Unsupported model"),统一走 Chat Completions 端点。
      // 思维链适配(reasoning_content 包装 + 思考开关)复用共享适配层
      fetch: createReasoningAwareFetch(),
    })
    return (modelId: string) => openai.chat(modelId)
  },
}
