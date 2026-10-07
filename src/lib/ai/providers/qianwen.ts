import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition, ModelDefinition } from "../types"
import { createReasoningAwareFetch } from "../openai-reasoning-adapter"

// 模型规格依据百炼模型文档(2026-09 实测):
// - qwen3.8 系列:多模态(Image/Text/Video 输入),1M 上下文,思考/非思考融合,默认开启思考
// - qwen3.7-plus:纯文本,1M 上下文(账号免费额度耗尽时调用返回 403 FreeTierOnly)

// 百炼免费额度锚点(2026-10-07 接入):平台 9 款模型各送 1M tokens(90 天内陆续到期),
// 全部经 DashScope 兼容端点 + 公共池同一把 qianwen key 调用(含 deepseek/kimi/glm 的
// 平台托管版)。锚点仅作门面行(PublicPoolModel)的能力继承来源与上游真名,标记
// upstreamOnly 不进用户模型列表与设置页内置管理;能力规格抄各厂内置同款
// (kimi-k3→moonshot、glm-5.3→zhipu、deepseek 系→deepseek),视觉能力除 qwen3.8
// 原厂系外一律保守标 false——DashScope 兼容层对第三方模型的图像注入透传未实测。
const bailianFreeTierAnchors: ModelDefinition[] = [
  { id: "qwen3.8-27b", name: "Qwen3.8 27B", provider: "qianwen", contextWindow: 1000000, supportsVision: true, supportsFiles: false, supportsReasoning: true, upstreamOnly: true },
  { id: "qwen3.8-max-0902", name: "Qwen3.8 Max 0902", provider: "qianwen", contextWindow: 1000000, supportsVision: true, supportsFiles: false, supportsReasoning: true, upstreamOnly: true },
  { id: "qwen3.7-flash", name: "Qwen3.7 Flash", provider: "qianwen", contextWindow: 1000000, supportsVision: false, supportsFiles: false, supportsReasoning: true, upstreamOnly: true },
  { id: "qwen3.7-flash-2026-07-15", name: "Qwen3.7 Flash 0715", provider: "qianwen", contextWindow: 1000000, supportsVision: false, supportsFiles: false, supportsReasoning: true, upstreamOnly: true },
  { id: "deepseek-v4-flash-0731", name: "DeepSeek V4 Flash 0731", provider: "qianwen", contextWindow: 1000000, supportsVision: false, supportsFiles: false, supportsReasoning: true, upstreamOnly: true },
  { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", provider: "qianwen", contextWindow: 1000000, supportsVision: false, supportsFiles: false, supportsReasoning: true, upstreamOnly: true },
  { id: "deepseek-v4-pro-0813", name: "DeepSeek V4 Pro 0813", provider: "qianwen", contextWindow: 1000000, supportsVision: false, supportsFiles: false, supportsReasoning: true, upstreamOnly: true },
  { id: "kimi-k3", name: "Kimi K3", provider: "qianwen", contextWindow: 1048576, supportsVision: false, supportsFiles: false, supportsReasoning: true, upstreamOnly: true },
  { id: "glm-5.3", name: "GLM-5.3", provider: "qianwen", contextWindow: 1000000, supportsVision: false, supportsFiles: false, supportsReasoning: true, upstreamOnly: true },
]

export const qianwenProvider: ProviderDefinition = {
  id: "qianwen",
  name: "通义千问",
  models: [
    { id: "qwen3.8-flash", name: "Qwen3.8 Flash", provider: "qianwen", contextWindow: 1000000, supportsVision: true, supportsFiles: false, supportsReasoning: true },
    { id: "qwen3.8-max", name: "Qwen3.8 Max", provider: "qianwen", contextWindow: 1000000, supportsVision: true, supportsFiles: false, supportsReasoning: true },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus", provider: "qianwen", contextWindow: 1000000, supportsVision: false, supportsFiles: false, supportsReasoning: true },
    ...bailianFreeTierAnchors,
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
