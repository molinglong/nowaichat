/**
 * AI 回复长度档位（reply length levels）
 *
 * 设计目标：把「详略」从对话风格预设里拆出来，做成一根独立可调的轴。
 * 此前详略打包在 style-presets.ts 的 verbosity 向量里（concise=0.15、scholar=0.8），
 * 用户无法「要学者语气，但只回三句话」。
 *
 * 档位的 prompt 落到可观察量级（字数上限、要点条数、是否举例、代码给多长），
 * 不依赖模型自行拿捏「简洁」这类抽象词；写作规范同 style-presets.ts：
 * 正向指令优先、职责分层。
 *
 * 生效方式：纯 system prompt 指令，不用 max_tokens 硬截断——后者会在半句话、
 * 半个代码块处掐断，且 1 token ≈ 0.6~1.5 汉字换算不准，推理模型还会把额度
 * 先花在思考链上。
 *
 * standard 是空操作档：不注入任何段落，保持现有行为完全不变。
 */

export type ReplyLengthId = 'minimal' | 'short' | 'standard' | 'detailed'

export interface ReplyLengthLevel {
  id: ReplyLengthId
  /** 中文显示名：滑杆刻度 + AI 快照取值映射 */
  label: string
  /** 一句话定位，写在滑杆档位说明 */
  tagline: string
  /** 补充提示（如深度思考下的表现），只在滑杆下方展示，不进 prompt */
  hint?: string
  /** 注入 system prompt 的长度段落；空串表示不注入 */
  prompt: string
}

/** 默认档——所有未识别 id / 旧数据均回退到这里，且不改变现有行为 */
export const DEFAULT_REPLY_LENGTH: ReplyLengthId = 'standard'

/**
 * 长度层通用前缀（与档位 prompt 一同注入，见 getReplyLengthPrompt）。
 *
 * 本段插在风格段之后，但注入顺序不等于优先级，需显式声明裁决规则，
 * 否则会和 concise 风格预设、以及「只输出译文」这类人格规则互相打架。
 */
export const LENGTH_LAYER_PREAMBLE: string = [
  '## 回复长度（只规定篇幅，不改变回答内容）',
  '- 优先级：用户本轮对长度的明确要求 > 面具人格的输出格式规则 > 本段 > 上文风格预设里的详略描述',
  '- "不受篇幅限制"只涵盖两样：已给出内容的事实准确性、以及操作风险的半句提醒；其余延伸解释都受篇幅约束',
  '- 用户明确要求展开或追问细节时，按该要求重新作答，不受本段篇幅约束',
].join('\n')

export const REPLY_LENGTH_LEVELS: readonly ReplyLengthLevel[] = [
  {
    id: 'minimal',
    label: '极简',
    tagline: '一句话给答案',
    hint: '开启深度思考时思考过程仍会展开，本档只压缩最终正文',
    prompt: [
      '## 回复长度：极简',
      '把回答压成一句话，像只有几秒钟时间的口头快报：',
      '- 正文不超过 30 字，只答用户这一问的核心答案，不附解释',
      '- 相邻知识点、延伸解释、常见追问，即使有价值也不写；不为「说得全」而加句',
      '- 不写标题、列表符号、开场白与结尾语；被问「为什么」也只用一句话答',
      '- 信息不足以给可靠答案时，用一句话说清缺什么，不要展开分析',
      '- 操作有破坏性（删数据、改线上、覆盖文件）时，把这半句风险提醒放进同一句话里',
    ].join('\n'),
  },
  {
    id: 'short',
    label: '简短',
    tagline: '结论加两三句，不举例',
    prompt: [
      '## 回复长度：简短',
      '先给答案，解释只留最必要的部分：',
      '- 正文控制在 150 字以内：第一句给结论，后面最多补 2 句理由或适用条件',
      '- 要点最多 3 条、每条一行；不写背景铺垫、举例与总结段',
      '- 代码只给关键片段（可省略样板与导入），不逐行注释',
      '- 用户追问「为什么」「再展开点」时，按标准详略重新作答',
    ].join('\n'),
  },
  {
    id: 'standard',
    label: '标准',
    tagline: '按内容需要自然展开',
    prompt: '',
  },
  {
    id: 'detailed',
    label: '详尽',
    tagline: '分层展开、附示例与边界',
    prompt: [
      '## 回复长度：详尽',
      '把这轮回答写成一份可独立查阅的说明，而不是对话里的快速应答：',
      '- 正文 500 字以上，按「结论 → 依据/原理 → 步骤 → 边界与坑 → 替代方案」分层展开',
      '- 每个关键结论附依据；有先后关系的用编号列表，可对比的用表格',
      '- 主动补一例具体示例（数值、场景或代码）；代码写完整可运行，含导入与错误处理',
      '- 结尾用 1-2 句点出使用前提、风险或下一步动作',
      '- 详尽指信息完整，不指字数灌水：删掉所有不承载信息的句子',
    ].join('\n'),
  },
]

/** 通过 id 查档位；找不到时返回默认（standard） */
export function getReplyLengthLevel(id: string | null | undefined): ReplyLengthLevel {
  if (!id) return getReplyLengthLevel(DEFAULT_REPLY_LENGTH)
  return (
    REPLY_LENGTH_LEVELS.find((l) => l.id === id) ??
    REPLY_LENGTH_LEVELS.find((l) => l.id === DEFAULT_REPLY_LENGTH)!
  )
}

/** 当前档位的中文显示名 */
export function getReplyLengthLabel(id: string | null | undefined): string {
  return getReplyLengthLevel(id).label
}

/**
 * 返回档位对应的 system prompt 段落（含长度层前缀）。
 * standard 返回空串，调用方据此跳过注入。
 */
export function getReplyLengthPrompt(id: string | null | undefined): string {
  const level = getReplyLengthLevel(id)
  if (!level.prompt) return ''
  return [LENGTH_LAYER_PREAMBLE, level.prompt].join('\n\n')
}
