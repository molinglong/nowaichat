/**
 * AI 对话风格参数配置（新版：preset 驱动）
 *
 * 历史背景：早期版本用一个 0-100 的 styleOffset 数字（0=严肃、50=平衡、100=幽默），
 * 现已升级为 6 个具名预设（balanced/practical/dev/editor/mentor/scholar），具体见
 * `./style-presets.ts`。下方只保留向后兼容的 legacy 函数，新代码请直接用
 * `./style-presets` 暴露的 `getStylePromptFromPreset` / `getStylePresetLabel`。
 */

export interface StyleConfig {
  offset: number // 0-100 (0=正式严肃，50=平衡中性，100=幽默风趣)—— legacy
}

// ──────────────────────────────────────────────────────────────────────────────
// Legacy: 按 0-100 阈值渲染三个分支（保留导出以防外部脚本引用，类型已不推荐）
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated 请改用 `getStylePromptFromPreset`。
 * 根据风格偏移量生成对应的 System Prompt
 * @param offset 风格偏移量 0-100
 */
export function getStylePrompt(offset: number = 50): string {
  const normalized = Math.max(0, Math.min(100, offset))

  if (normalized <= 30) {
    return [
      '## 对话风格：正式严肃',
      '以专业、严谨的方式进行对话:',
      '- 语言简洁准确，避免口语化表达',
      '- 使用规范的专业术语',
      '- 注重事实准确性和逻辑严密性',
      '- 保持客观中立，不随意添加玩笑或调侃',
      '- 结构化表达，条理清晰',
      '- 适合工作场景和专业讨论',
    ].join('\n')
  } else if (normalized >= 70) {
    return [
      '## 对话风格：幽默风趣',
      '让对话轻松有趣，但不失专业性:',
      '- 适当使用网络流行语、梗和幽默表达',
      '- 语气活泼，可以加入适度的调侃',
      '- 用生动的例子和比喻解释概念',
      '- 在严肃话题外可以开点小玩笑',
      '- 保持友好亲切，拉近距离感',
      '- 但要注意分寸，不降低回答质量',
    ].join('\n')
  } else {
    return [
      '## 对话风格：平衡自然',
      '保持专业友好的对话方式:',
      '- 语言自然流畅，不过于正式也不过度随意',
      '- 适度使用轻松的表达方式',
      '- 注重实用性和可读性',
      '- 在专业内容外可以有适度的亲和力',
    ].join('\n')
  }
}

/**
 * @deprecated 请改用 `getStylePresetLabel`。
 * 获取风格的可视化标签（用于旧版 slider 显示）
 * @param offset 风格偏移量
 */
export function getStyleLabel(offset: number = 50): string {
  if (offset <= 30) {
    return '严肃'
  } else if (offset >= 70) {
    return '幽默'
  } else {
    return '平衡'
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 新版：preset 驱动（推荐）
// ──────────────────────────────────────────────────────────────────────────────

export {
  STYLE_PRESETS,
  DEFAULT_STYLE_PRESET,
  getStylePreset,
  getStylePresetLabel,
  getStylePromptFromPreset,
  presetFromOffset,
  type StylePreset,
  type StylePresetId,
} from './style-presets'
