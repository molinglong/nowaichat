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
import { groqProvider } from "./providers/groq"
import { prisma } from "@/lib/db"
import { getModelTotalConsumed } from "@/lib/quota"

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
  // 零一万物 Yi:开放平台已于 2026-09-03 停止 API 服务,整体下线(见 LEGACY_MODEL_ALIASES 末尾注释)
}

// =================== 同步（仅硬编码内置模型）===================
// 适用于：纯静态场景、API Key 配置提示、ChatPanel 默认 model 兜底等不需要用户上下文的场景。

// Get all builtin models across all providers (no user override)
export function getAllModels(): ModelDefinition[] {
  return Object.values(providers).flatMap(p => p.models)
}

// 已下线模型名归一化。查找时统一映射到当前主力模型,老对话无需迁移即可继续使用
// (见错误分支:查不到定义会直接 400 Unknown model,所以删除前必须先在这里补映射)。
// 维护规则:只有当某 id 被官方确认**已下线/已停用**时才删除并在此登记;
// 仅是"已出新一代但仍可调用"的旧模型请留在清单里标 tier: "legacy",不要删。
const LEGACY_MODEL_ALIASES: Record<string, string> = {
  // DeepSeek:V3 时代的 chat/reasoner/coder 已并入 deepseek-flash,
  // 思考与否改由 thinking 请求参数控制(见 chat 路由)。
  "deepseek-chat": "deepseek-flash",
  "deepseek-reasoner": "deepseek-flash",
  "deepseek-coder": "deepseek-flash",
  // Anthropic:Claude 4 / 3.x 已于 2026-06-15 退市
  "claude-opus-4-20250514": "claude-opus-4-7",
  "claude-sonnet-4-20250514": "claude-sonnet-4-6",
  "claude-3-7-sonnet-20250219": "claude-sonnet-4-6",
  "claude-3-5-sonnet-20241022": "claude-sonnet-4-6",
  "claude-3-5-haiku-20241022": "claude-haiku-4-5-20251001",
  "claude-3-opus-20240229": "claude-opus-4-7",
  "claude-3-haiku-20240307": "claude-haiku-4-5-20251001",
  // Google:Gemini 2.0 系已关停,1.5 系与 3 Pro 预览端点已下线
  "gemini-2.0-flash": "gemini-3.5-flash",
  "gemini-2.0-flash-lite": "gemini-3.5-flash-lite",
  "gemini-1.5-pro": "gemini-3.1-pro-preview",
  "gemini-1.5-flash": "gemini-3.5-flash",
  "gemini-1.5-flash-8b": "gemini-3.5-flash-lite",
  "gemini-3-pro-preview": "gemini-3.1-pro-preview",
  // 文心:ERNIE 4.0 / 3.5 / Speed / Tiny 已不在在售清单
  "ernie-4.0-8k": "ernie-5.1",
  "ernie-4.0-turbo-8k": "ernie-5.1",
  "ernie-4.0-8k-latest": "ernie-5.1",
  "ernie-3.5-8k": "ernie-5.1",
  "ernie-3.5-8k-latest": "ernie-5.1",
  "ernie-speed-8k": "ernie-5.1",
  "ernie-speed-128k": "ernie-5.1",
  "ernie-tiny-8k": "ernie-5.1",
  // Kimi:moonshot-v1 全系与 kimi-latest 已下线
  "kimi-latest": "kimi-k3",
  "kimi-k2-0905-preview": "kimi-k2.6",
  "moonshot-v1-8k": "kimi-k2.6",
  "moonshot-v1-32k": "kimi-k2.6",
  "moonshot-v1-128k": "kimi-k2.6",
  "moonshot-v1-vision-preview": "kimi-k3",
  // 豆包:doubao-pro / doubao-lite 一代已不在在售清单
  "doubao-pro-32k": "doubao-seed-2-1-pro-260915",
  "doubao-pro-256k": "doubao-seed-2-1-pro-260915",
  "doubao-lite-32k": "doubao-seed-2-1-lite-260915",
  "doubao-lite-128k": "doubao-seed-2-1-lite-260915",
  "doubao-vision-pro-32k": "doubao-seed-2-1-pro-260915",
  // 注:零一万物 Yi 开放平台已于 2026-09-03 停止 API 服务,provider 已整体移除,
  // 无同类可替代模型,故不设别名;命中 yi-* 的老会话会明确报 Unknown model。
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
    m => !m.upstreamOnly && !hiddenSet.has(`${m.provider}:${m.id}`)
  )

  // 过滤掉被用户添加同名覆盖的内置模型，让用户配置生效
  const builtinFiltered = builtinVisible.filter(m => !userAddedIds.has(m.id))

  // 公共池门面模型（管理员在 DB 维护）：对所有人可见，服务端出钱+计费语义在 chat route。
  // 放在最后：首跑默认取 find(m => m.publicPool)，与排序无关
  const publicPoolModels = await getPublicPoolModelDefs()

  return [...builtinFiltered, ...userAddedModels, ...publicPoolModels]
}

/**
 * 公共池门面模型（PublicPoolModel 表，enabled 行）→ ModelDefinition。
 * 能力（上下文窗/视觉/推理）从 upstreamId 指向的内置定义继承；上游锚点必须
 * 是同 provider 的内置定义，查不到即丢行（管理员配置错误的防呆）。
 * 全站累计消耗达到 capTokens（预算，0=不限）的行不返回——停运+用户端隐藏，
 * 管理员改大 cap 即恢复；用量查询失败时放行（宁可多发，不因辅助查询误杀全部门面）。
 */
export async function getPublicPoolModelDefs(): Promise<ModelDefinition[]> {
  const rows = await prisma.publicPoolModel.findMany({
    where: { enabled: true },
    orderBy: { createdAt: 'asc' },
  })
  let usage: Map<string, number> | null = null
  try {
    usage = await getModelTotalConsumed()
  } catch (err) {
    console.error("[registry] model usage lookup failed, skip cap filter:", err)
  }
  // 复合键建表:不同 provider 允许同名上游(qianwen 锚点 kimi-k3 与 moonshot 内置
  // kimi-k3 互不踩),查找时强制门面行 provider 与锚点 provider 一致——不一致即丢行
  const builtin = new Map(getAllModels().map(m => [`${m.provider}:${m.id}`, m]))
  const defs: ModelDefinition[] = []
  for (const r of rows) {
    const upstream = builtin.get(`${r.provider}:${r.upstreamId}`)
    if (!upstream) continue
    if (usage && r.capTokens > 0 && (usage.get(r.id) ?? 0) >= r.capTokens) continue
    defs.push({
      id: r.id,
      name: r.name,
      provider: r.provider,
      contextWindow: upstream.contextWindow,
      supportsVision: upstream.supportsVision,
      supportsFiles: upstream.supportsFiles,
      supportsReasoning: upstream.supportsReasoning,
      publicPool: true,
      upstreamId: r.upstreamId,
    })
  }
  return defs
}

/**
 * 该模型不可用是否因「公共门面模型预算触顶被隐藏」：是则回模型名给聊天路由出
 * 「额度已用完」的明确文案（否则用户只会看到「不在可用列表中」，误以为模型没了）。
 * 已停用/未触顶/非门面一律 null 走通用分支。
 */
export async function getCappedPublicPoolModel(modelId: string): Promise<{ name: string } | null> {
  const row = await prisma.publicPoolModel
    .findUnique({ where: { id: normalizeModelId(modelId) } })
    .catch(() => null)
  if (!row || !row.enabled || row.capTokens <= 0) return null
  try {
    const usage = await getModelTotalConsumed()
    return (usage.get(row.id) ?? 0) >= row.capTokens ? { name: row.name } : null
  } catch {
    return null
  }
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
