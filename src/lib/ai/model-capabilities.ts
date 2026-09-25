/**
 * 模型能力关键词检测 —— 从 SettingsModal「添加模型到服务商」表单抽出，
 * 供两条路径共用，避免正则两处漂移：
 * - 手动表单（输入 modelId 时智能勾选能力）
 * - manage_provider_models 卡片（AI 未显式指定能力时的执行兜底）
 *
 * 纯常量模块（isomorphic，无任何依赖），客户端组件可安全 import。
 * 命中规则保守：拿不准就判 false，宁可少勾（用户可手动改），不可误判
 * （误判 vision=true 会让用户发图给不支持读图的模型，直接调用报错）。
 */

export interface DetectedModelCapabilities {
  supportsVision: boolean
  supportsFiles: boolean
  supportsReasoning: boolean
}

const VISION_RE =
  /vision|vl|gpt-4o|claude.*3|qwen-vl|gemini|qwen2\.5|claude-sonnet|claude-opus|4o|vision-latest/i
const REASONING_RE =
  /reasoning|r1|o1|o3|deepseek-r1|deepseek-reasoner|claude-3\.7|thinking|openai-o1|openai-o3/i
const FILES_RE = /file|code|coder/i

/** 按模型 ID 关键词推断能力（默认全 false） */
export function detectModelCapabilities(modelId: string): DetectedModelCapabilities {
  return {
    supportsVision: VISION_RE.test(modelId),
    supportsReasoning: REASONING_RE.test(modelId),
    supportsFiles: FILES_RE.test(modelId),
  }
}
