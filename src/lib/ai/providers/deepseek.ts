import { createDeepSeek } from "@ai-sdk/deepseek"
import { ProviderDefinition } from "../types"

export const deepseekProvider: ProviderDefinition = {
  id: "deepseek",
  name: "DeepSeek",
  models: [
    // V4.1-Flash: 日常性价比主力(输出 4~8 元/百万tokens,空闲时段减半)。V3 时代
    // chat/reasoner 的非思考/思考分家已并入本模型,思考改由请求参数 thinking 控制
    // (默认 enabled),服务端按 deepThink 开关注入 providerOptions(见 chat 路由)。
    { id: "deepseek-flash", name: "DeepSeek-V4.1-Flash", provider: "deepseek", contextWindow: 1000000, supportsVision: true, supportsFiles: false, supportsReasoning: true },
    // V4-Pro: 复杂推理/大型任务用,输出价格约为 Flash 的 3.4 倍,不支持图像理解。
    { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro", provider: "deepseek", contextWindow: 1000000, supportsVision: false, supportsFiles: false, supportsReasoning: true },
  ],
  createProvider: (apiKey: string) => createDeepSeek({
    apiKey,
    baseURL: "https://api.deepseek.com",
  }),
}
