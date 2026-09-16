import { createOpenAI } from "@ai-sdk/openai"
import { ProviderDefinition } from "../types"

export const wenxinProvider: ProviderDefinition = {
  id: "wenxin",
  name: "文心一言",
  models: [
    // ERNIE 4.0 系列
    { id: "ernie-4.0-8k", name: "ERNIE 4.0", provider: "wenxin", contextWindow: 8000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "ernie-4.0-turbo-8k", name: "ERNIE 4.0 Turbo", provider: "wenxin", contextWindow: 8000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "ernie-4.0-8k-latest", name: "ERNIE 4.0 Latest", provider: "wenxin", contextWindow: 8000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    // ERNIE 3.5 系列
    { id: "ernie-3.5-8k", name: "ERNIE 3.5", provider: "wenxin", contextWindow: 8000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "ernie-3.5-8k-latest", name: "ERNIE 3.5 Latest", provider: "wenxin", contextWindow: 8000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    // ERNIE Speed / Tiny 系列
    { id: "ernie-speed-8k", name: "ERNIE Speed 8K", provider: "wenxin", contextWindow: 8000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "ernie-speed-128k", name: "ERNIE Speed 128K", provider: "wenxin", contextWindow: 128000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
    { id: "ernie-tiny-8k", name: "ERNIE Tiny", provider: "wenxin", contextWindow: 8000, supportsVision: false, supportsFiles: false, supportsReasoning: false },
  ],
  createProvider: (apiKey: string) => createOpenAI({
    apiKey,
    baseURL: "https://qianfan.baidubce.com/v2"
  }),
}
