/**
 * 自定义模型公共逻辑模块
 * - 构建 ModelDefinition 供 UI 使用
 * - 解析 API Key（独立 key / 复用已有 provider key）
 * - 创建 OpenAI 兼容的 provider 实例
 * - 自动检测模型能力（视觉/推理）
 */

import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/crypto"
import { providers } from "./registry"
import { createReasoningAwareFetch } from "./openai-reasoning-adapter"
import type { ModelDefinition } from "./types"

// 数据库行类型
export interface CustomModelRow {
  id: string
  userId: string
  name: string
  modelId: string
  baseURL: string
  protocol?: string | null
  apiKey?: string | null // encrypted
  keyProvider?: string | null
  contextWindow: number
  supportsVision: boolean
  supportsFiles: boolean
  supportsReasoning: boolean
}

export interface DetectedCapabilities {
  supportsVision: boolean
  supportsReasoning: boolean
  // supportsFiles 当前 OpenAI 兼容接口无法纯运行时检测（需后端元数据），由用户自行判断
  supportsFiles?: boolean
}

// 从 DB 行构建 ModelDefinition（用于 ModelSelector）
export function buildCustomModelDefinition(cm: CustomModelRow): ModelDefinition {
  return {
    id: `custom:${cm.id}`,
    name: cm.name,
    provider: "custom",
    contextWindow: cm.contextWindow,
    supportsVision: cm.supportsVision,
    supportsFiles: cm.supportsFiles,
    supportsReasoning: cm.supportsReasoning,
  }
}

// 解析 API key（返回明文）
// 优先级：独立 apiKey > keyProvider 对应已配置 key > undefined(某些本地服务无需鉴权)
export async function resolveApiKey(userId: string, cm: CustomModelRow): Promise<string | undefined> {
  if (cm.apiKey) {
    try {
      return decrypt(cm.apiKey)
    } catch (err) {
      console.error("[custom-model] Failed to decrypt own apiKey:", err)
    }
  }
  if (cm.keyProvider) {
    const rec = await prisma.apiKey.findFirst({
      where: { userId, provider: cm.keyProvider },
    })
    if (rec) {
      try {
        return decrypt(rec.encryptedKey)
      } catch (err) {
        console.error(`[custom-model] Failed to decrypt ${cm.keyProvider} key:`, err)
      }
    }
  }
  return undefined // 免鉴权模式，本地 Ollama/LM Studio 等常用密钥 "local"
}

// 创建自定义模型的 provider 实例
// 复用服务商 Key 且未填 Base URL → 直接用该服务商原生实例（支持任意该服务商模型 ID）
// 其余情况 → OpenAI 兼容协议实例（需要 Base URL）
export type CustomModelProtocol = "chat" | "responses" | "anthropic"

export function getCustomModelProtocol(cm: Pick<CustomModelRow, "modelId" | "baseURL" | "protocol">): CustomModelProtocol {
  if (cm.protocol === "responses" || cm.protocol === "chat" || cm.protocol === "anthropic") return cm.protocol
  if (cm.modelId.toLowerCase() === "gpt-5.4-pro") {
    return "responses"
  }
  return "chat"
}

function normalizeCustomBaseURL(value: string | undefined) {
  if (!value || value.trim() === "") return undefined
  const input = value.trim().replace(/\/+$/, "")
  try {
    const url = new URL(input)
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/v1"
    }
    return url.toString().replace(/\/$/, "")
  } catch {
    return input
  }
}

export function createCustomProviderInstance(cm: CustomModelRow, apiKey: string | undefined) {
  const baseURL = normalizeCustomBaseURL(cm.baseURL)

  if (!baseURL && cm.keyProvider) {
    const builtin = providers[cm.keyProvider]
    if (builtin) {
      const key = apiKey && apiKey.trim() !== "" ? apiKey : "local"
      return builtin.createProvider(key)
    }
  }

  const opts: Parameters<typeof createOpenAI>[0] = {}
  if (apiKey && apiKey.trim() !== "") {
    opts.apiKey = apiKey
  } else {
    // 很多本地服务需要 apiKey 参数但不真正验证
    opts.apiKey = "local"
  }
  if (baseURL) {
    opts.baseURL = baseURL
  }
  // 思维链适配:OpenAI 兼容端点常把思维链只放在 reasoning_content 字段,
  // @ai-sdk/openai 不解析该字段 → 思考过程静默丢失。fetch 层包装为 <think> 文本
  // 交给 chat 路由的 extractReasoningMiddleware 统一抽取(DashScope 端点额外做思考开关)。
  // 不含 reasoning_content 的响应原样透传,对普通模型零副作用。
  opts.fetch = createReasoningAwareFetch()
  return createOpenAI(opts)
}

export function createCustomLanguageModel(cm: CustomModelRow, apiKey: string | undefined) {
  const protocol = getCustomModelProtocol(cm)
  if (protocol === "anthropic") {
    const baseURL = normalizeCustomBaseURL(cm.baseURL)
    const provider = createAnthropic({
      apiKey: apiKey && apiKey.trim() !== "" ? apiKey : "local",
      ...(baseURL ? { baseURL } : {}),
    })
    return provider(cm.modelId)
  }

  const provider = createCustomProviderInstance(cm, apiKey) as ReturnType<typeof createOpenAI>
  if (protocol === "chat") {
    if (!provider.chat) {
      throw new Error("当前 AI SDK 不支持 Chat Completions API，请升级 @ai-sdk/openai")
    }
    return provider.chat(cm.modelId)
  }

  if (!provider.responses) {
    throw new Error("当前 AI SDK 不支持 Responses API，请升级 @ai-sdk/openai")
  }
  return provider.responses(cm.modelId)
}

// 测试连接（仅调用生成文本，不持久化）
export async function testCustomModelConnection(
  userId: string,
  cm: CustomModelRow
): Promise<{ ok: boolean; error?: string }> {
  try {
    const apiKey = await resolveApiKey(userId, cm)
    const model = createCustomLanguageModel(cm, apiKey)
    console.log(`[custom-model] Testing model ${cm.modelId} (baseURL=${cm.baseURL || 'USE_PROVIDER_KEY'}, keySource=${cm.apiKey ? 'own' : cm.keyProvider})`)
    const result = await import("ai").then((ai) =>
      ai.generateText({
        model,
        prompt: "ping",
        maxOutputTokens: 8,
      })
    )
    // AI SDK v7 returns 'response' not 'responseId'
    if (result.response || result.text) {
      return { ok: true }
    }
    return { ok: false, error: "服务器无响应" }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "未知错误"
    const stack = err instanceof Error && err.stack ? `\n${err.stack.split('\n').slice(1).join('\n')}` : ''
    console.error(`[custom-model] Test FAILED for ${cm.modelId}:`, msg, stack)
    return { ok: false, error: msg }
  }
}

/**
 * 自动检测自定义模型的能力
 * - 视觉：发送一张 1x1 透明 PNG 图片，看能否成功
 * - 推理：两重判断 —— ① 模型 ID 关键词启发式（含思考融合模型）；
 *   ② 启发式未命中时实发一次请求,响应含思维链(reasoning_content/<think>)即视为支持。
 *
 * 注：检测失败不会抛出错误，只返回检测到的能力（保守地标记为 false）
 */
export async function detectCustomModelCapabilities(
  userId: string,
  cm: CustomModelRow
): Promise<DetectedCapabilities> {
  const result: DetectedCapabilities = {
    supportsVision: false,
    supportsReasoning: false,
  }

  const apiKey = await resolveApiKey(userId, cm).catch(() => undefined)
  if (!apiKey) return result

  // 1. 基于模型 ID 的启发式判断（推理）
  const id = cm.modelId.toLowerCase()
  const reasoningKeywords = [
    "reasoning", "thinking", "r1", "o1", "o3", "qwq",
    "deepseek-r1", "deepseek-reasoner", "stepfun", "yi-lightning",
    "magistral", "opus-4", "opus-4.1", "sonnet-4.5-thinking",
    // 思考融合模型默认开思考,关键词补齐(2026-09 实测)
    "glm-4.5", "glm-4.6", "glm-5", "kimi-k2", "minimax-m2", "grok-4",
  ]
  if (reasoningKeywords.some((kw) => id.includes(kw))) {
    result.supportsReasoning = true
  }

  // 2. 实发请求探测思维链:关键词启发式对改名模型(聚合站自定义 ID)常失灵,
  //    直接问一个简单问题,响应里带 reasoning_content 即视为支持推理。
  //    fetch 适配层会把 reasoning_content 包成 <think> 文本,两种形态都识别。
  //    DashScope 端点:fetch 层无 reasoning_effort 时会强制关思考(快答优化),
  //    探测时需显式传档位才能触发思维链。
  if (!result.supportsReasoning) {
    try {
      const model = createCustomLanguageModel(cm, apiKey)
      const isDashScope = /dashscope\.aliyuncs\.com/i.test(cm.baseURL || "")
      const res = await import("ai").then((ai) =>
        ai.generateText({
          model,
          prompt: "1+1=?只回答数字",
          maxOutputTokens: 512,
          ...(isDashScope
            ? { providerOptions: { openai: { reasoningEffort: "medium" } } }
            : {}),
        })
      )
      if (res.reasoningText?.trim() || res.text.includes("<think>")) {
        result.supportsReasoning = true
      }
    } catch {
      // 探测失败不影响启发式结果,保守保持 false
    }
  }

  // 3. 基于模型 ID 的启发式判断（视觉）
  const visionKeywords = [
    "vision", "gpt-4o", "gpt-4-vision", "gpt-4-turbo", "gpt-5",
    "claude-3", "claude-4", "claude-sonnet-4", "claude-opus-4",
    "gemini", "qwen-vl", "qwen2-vl", "qwen2.5-vl", "qvq",
    "llava", "minicpm-v", "internvl", "yi-vl", "qwen3.8",
  ]
  if (visionKeywords.some((kw) => id.includes(kw))) {
    result.supportsVision = true
  }

  // 4. 实际探测视觉能力（仅对未通过启发式判断的）
  if (!result.supportsVision) {
    try {
      const model = createCustomLanguageModel(cm, apiKey)
      // 1x1 透明 PNG base64
      const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII="
      await import("ai").then((ai) =>
        ai.generateText({
          model,
          prompt: [
            { type: "text", text: "看图回答：图中是什么颜色？" },
            { type: "image", image: new URL(`data:image/png;base64,${tinyPng}`) },
          ] as any,
          maxOutputTokens: 8,
        })
      )
      result.supportsVision = true
    } catch {
      // 探测失败，保守标记为 false
    }
  }

  return result
}
