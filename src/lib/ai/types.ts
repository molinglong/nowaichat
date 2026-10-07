/**
 * 模型代际分层：
 * - mainstream 当前主力，模型选择器默认展示
 * - legacy     仍在售但已被新一代取代，默认折叠，需手动展开「显示旧版」
 */
export type ModelTier = "mainstream" | "legacy"

export interface ModelDefinition {
  id: string           // e.g. "gpt-4o"
  name: string         // 显示名 e.g. "GPT-4o"
  provider: string     // provider key e.g. "openai"
  contextWindow: number
  supportsVision: boolean
  supportsFiles: boolean
  supportsReasoning: boolean  // 是否原生支持推理/思考（如 DeepSeek-R1, o1 等）
  /** 省略等同 mainstream（用户自定义模型与历史数据无需补该字段） */
  tier?: ModelTier
  /** 公共池门面模型：注册即用，一律服务端出钱 + 公共额度计费，模型选择器对所有人可见 */
  publicPool?: boolean
  /** 门面模型发上游用的真实模型 id（如「标准」复用 deepseek-flash 引擎）；缺省即 id 本身 */
  upstreamId?: string
  /** 仅作公共池门面的上游锚点（能力继承来源+上游真名），不进用户模型列表与设置页内置管理 */
  upstreamOnly?: boolean
}

export interface ProviderDefinition {
  id: string           // e.g. "openai"
  name: string         // 显示名 e.g. "OpenAI"
  models: ModelDefinition[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createProvider: (apiKey: string) => any  // 返回 AI SDK provider 实例
}
