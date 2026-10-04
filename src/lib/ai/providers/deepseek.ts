import { createDeepSeek } from "@ai-sdk/deepseek"
import { ProviderDefinition } from "../types"

/**
 * DeepSeek 思考模式契约:请求开启 thinking 时,历史 assistant 工具调用轮必须携带
 * reasoning_content,否则上游 400("The `reasoning_content` in the thinking mode
 * must be passed back")。混合思考流(chat 路由 deepThink 首步定向检索:第 0 步关
 * 思考强制调 search_knowledge,第 1 步起恢复思考)的第 0 步轮次没有 reasoning_content,
 * 换请求思考模式后必挂。这里在 fetch 层对缺失的 assistant tool_calls 轮补中性占位;
 * 仅 thinking=enabled 的请求参与,其余请求零改动(纯思考流自带 reasoning_content,
 * 非思考流不带 thinking 字段,均不会被触碰)。
 */
function backfillReasoningContent(init: RequestInit | undefined): RequestInit | undefined {
  if (!init || typeof init.body !== "string" || !init.body.startsWith("{")) return init
  try {
    const parsed = JSON.parse(init.body) as {
      thinking?: { type?: string }
      messages?: Array<{ role?: string; reasoning_content?: unknown; tool_calls?: unknown }>
    }
    if (parsed.thinking?.type !== "enabled" || !Array.isArray(parsed.messages)) return init
    let patched = false
    for (const msg of parsed.messages) {
      if (
        msg.role === "assistant" &&
        msg.tool_calls != null &&
        typeof msg.reasoning_content !== "string"
      ) {
        msg.reasoning_content = "（此步为定向工具调用，未开启思考。）"
        patched = true
      }
    }
    if (!patched) return init
    return { ...init, body: JSON.stringify(parsed) }
  } catch {
    return init
  }
}

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
    fetch: async (input, init) => fetch(input, backfillReasoningContent(init)),
  }),
}
