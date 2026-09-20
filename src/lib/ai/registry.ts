import { ProviderDefinition, ModelDefinition } from "./types"
import { openaiProvider } from "./providers/openai"
import { anthropicProvider } from "./providers/anthropic"
import { deepseekProvider } from "./providers/deepseek"
import { qianwenProvider } from "./providers/qianwen"
import { wenxinProvider } from "./providers/wenxin"
import { googleProvider } from "./providers/google"
import { moonshotProvider } from "./providers/moonshot"
import { zhipuProvider } from "./providers/zhipu"
import { mistralProvider } from "./providers/mistral"
import { xaiProvider } from "./providers/xai"
import { doubaoProvider } from "./providers/doubao"
import { yiProvider } from "./providers/yi"
import { groqProvider } from "./providers/groq"
import { prisma } from "@/lib/db"

// All registered providers
export const providers: Record<string, ProviderDefinition> = {
  // 国际主流
  openai: openaiProvider,
  anthropic: anthropicProvider,
  google: googleProvider,
  mistral: mistralProvider,
  xai: xaiProvider,
  groq: groqProvider,
  // 国内主流
  deepseek: deepseekProvider,
  qianwen: qianwenProvider,
  wenxin: wenxinProvider,
  moonshot: moonshotProvider,
  zhipu: zhipuProvider,
  doubao: doubaoProvider,
  yi: yiProvider,
}

// =================== 同步（仅硬编码内置模型）===================
// 适用于：纯静态场景、API Key 配置提示、ChatPanel 默认 model 兜底等不需要用户上下文的场景。

// Get all builtin models across all providers (no user override)
export function getAllModels(): ModelDefinition[] {
  return Object.values(providers).flatMap(p => p.models)
}

// DeepSeek 旧模型名归一化:V3 时代的 chat/reasoner/coder 已并入 deepseek-flash,
// 思考与否改由 thinking 请求参数控制(见 chat 路由)。老会话 model 字段存的旧 id
// 在 getModel/getEffectiveModel 查找时统一映射,老对话无需迁移即可继续使用。
const LEGACY_MODEL_ALIASES: Record<string, string> = {
  "deepseek-chat": "deepseek-flash",
  "deepseek-reasoner": "deepseek-flash",
  "deepseek-coder": "deepseek-flash",
}

export function normalizeModelId(modelId: string): string {
  return LEGACY_MODEL_ALIASES[modelId] ?? modelId
}

// Get a specific builtin model definition (no user override)
export function getModel(modelId: string): ModelDefinition | undefined {
  return getAllModels().find(m => m.id === normalizeModelId(modelId))
}

// Get the provider for a given model (no user override)
export function getProviderForModel(modelId: string): ProviderDefinition | undefined {
  const model = getModel(modelId)
  if (!model) return undefined
  return providers[model.provider]
}

// Create an AI SDK provider instance for a given model with the user's API key
export function createProviderInstance(modelId: string, apiKey: string) {
  const provider = getProviderForModel(modelId)
  if (!provider) throw new Error(`Unknown model: ${modelId}`)
  return provider.createProvider(apiKey)
}

// =================== 异步（用户级有效模型）===================
// 适用于：模型选择器下拉、Chat 路由校验、Explore 模型选择。
// 合并规则：
//   - 内置预置模型 - 用户标记 isHidden 的行
//   - + 用户添加的非隐藏行（isHidden=false, name 非空）追加到对应 provider 下

/**
 * 获取指定用户可见的有效模型列表（合并内置 + 用户覆盖）。
 * - 过滤掉用户在 ProviderModelOverride 表里标记 isHidden=true 的内置模型
 * - 追加用户在 ProviderModelOverride 表里 isHidden=false 的自定义模型（使用对应 provider 的 Key）
 */
export async function getEffectiveModels(userId: string): Promise<ModelDefinition[]> {
  const overrides = await prisma.providerModelOverride.findMany({
    where: { userId },
  })

  const hiddenSet = new Set(
    overrides.filter(o => o.isHidden).map(o => `${o.provider}:${o.modelId}`)
  )

  const userAddedModels: ModelDefinition[] = overrides
    .filter(o => !o.isHidden)
    .map(o => ({
      id: o.modelId,
      name: o.name,
      provider: o.provider,
      contextWindow: o.contextWindow,
      supportsVision: o.supportsVision,
      supportsFiles: o.supportsFiles,
      supportsReasoning: o.supportsReasoning,
    }))

  // 用户添加的模型 ID 集合：用于排除同名内置模型（避免 shadow）
  const userAddedIds = new Set(userAddedModels.map(m => m.id))

  const builtinVisible = getAllModels().filter(
    m => !hiddenSet.has(`${m.provider}:${m.id}`)
  )

  // 过滤掉被用户添加同名覆盖的内置模型，让用户配置生效
  const builtinFiltered = builtinVisible.filter(m => !userAddedIds.has(m.id))

  return [...builtinFiltered, ...userAddedModels]
}

/**
 * 按 modelId 查找某个用户的有效模型定义。
 * 优先级：用户添加 > 内置（未隐藏），避免同名 ID 被内置 shadow。
 */
export async function getEffectiveModel(
  userId: string,
  modelId: string
): Promise<ModelDefinition | undefined> {
  const all = await getEffectiveModels(userId)
  return all.find(m => m.id === normalizeModelId(modelId))
}

/**
 * 为指定 modelId 创建 provider 实例（用户级）。
 * 注意：用户级新增的模型复用对应 provider 的 baseURL 和 createProvider 工厂，
 * 所以 createProviderInstance 与内置共用同一个函数即可。
 */
export function createProviderInstanceForEffectiveModel(
  modelDef: ModelDefinition,
  apiKey: string
) {
  const provider = providers[modelDef.provider]
  if (!provider) throw new Error(`Unknown provider: ${modelDef.provider}`)
  return provider.createProvider(apiKey)
}
