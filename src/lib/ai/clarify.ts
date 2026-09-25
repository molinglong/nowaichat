import { tool } from "ai"
import { z } from "zod"

/**
 * 澄清提问工具（ask_clarification）
 *
 * 设计目标：用户需求信息不足时，让模型先以结构化卡片提出澄清问题，
 * 用户点选/补充回答后作为普通 user 消息回流，开启新一轮正式生成。
 *
 * 与 web_search 的关键差异：无 execute —— tool call 输出后本轮流即结束
 * （AI SDK 对无 execute 工具不会自动续跑），前端把 tool part 渲染为
 * ClarifyCard 交互卡片；服务端 onFinish 照常把 tool input 收进
 * metadata.toolCalls 持久化，历史回放走同一渲染分支。
 */

export const CLARIFY_TOOL_NAME = "ask_clarification"

export const clarifyInputSchema = z.object({
  intro: z
    .string()
    .max(80)
    .describe('一句话引入语，说明为什么要确认，如"为了帮你写好周报，先确认几点："'),
  questions: z
    .array(
      z.object({
        question: z.string().max(60).describe("问题文本，具体、可直接回答"),
        options: z
          .array(z.string().max(40))
          .min(2)
          .max(4)
          .describe("2-4 个预设选项，覆盖最常见情形；写具体事实而非抽象词"),
        allowCustom: z.boolean().describe("该问题是否允许用户自由填写补充答案"),
        multiSelect: z
          .boolean()
          .optional()
          .describe(
            "选项是否可多选(各选项不互斥、可同时成立时 true,如并列偏好/多项需求);缺省为单选"
          ),
      })
    )
    .min(1)
    .max(3)
    .describe("1-3 个澄清问题，只问缺失的关键信息"),
})

export type ClarifyToolInput = z.infer<typeof clarifyInputSchema>

/** 前端渲染用的宽松问题形状（历史 metadata 里 input 可能缺字段，逐字段兜底） */
export interface ClarifyQuestionView {
  question: string
  options: string[]
  allowCustom: boolean
  /** 该题选项是否可多选(历史消息缺该字段时回退 false 单选) */
  multiSelect: boolean
}

/**
 * 从任意来源（tool part input / metadata toolCalls input）提取可渲染的问题列表，
 * 字段缺失或类型不符时逐项跳过，不让一张坏卡片阻塞整个消息渲染。
 */
export function toClarifyQuestions(input: unknown): ClarifyQuestionView[] {
  if (!input || typeof input !== "object") return []
  const raw = (input as { questions?: unknown }).questions
  if (!Array.isArray(raw)) return []
  const out: ClarifyQuestionView[] = []
  for (const q of raw) {
    if (!q || typeof q !== "object") continue
    const question = (q as { question?: unknown }).question
    const options = (q as { options?: unknown }).options
    if (typeof question !== "string" || !question.trim()) continue
    if (!Array.isArray(options) || options.length === 0) continue
    out.push({
      question,
      options: options.filter((o): o is string => typeof o === "string" && !!o.trim()),
      allowCustom: (q as { allowCustom?: unknown }).allowCustom === true,
      multiSelect: (q as { multiSelect?: unknown }).multiSelect === true,
    })
  }
  return out
}

/** 从 input 提取引入语（缺省返回空串，卡片用默认文案） */
export function toClarifyIntro(input: unknown): string {
  if (!input || typeof input !== "object") return ""
  const intro = (input as { intro?: unknown }).intro
  return typeof intro === "string" ? intro.trim() : ""
}

/**
 * 创建澄清提问工具（无 execute，见文件头注释）
 */
export function createClarifyTool() {
  return tool({
    description:
      "向用户提出澄清问题。当用户的需求缺少关键信息、按现有信息回答会明显偏离预期时调用；" +
      "一次提出全部问题（1-3 个），每个问题附带 2-4 个用户可直接点选的选项；" +
      "选项彼此不互斥、可同时成立的题目把 multiSelect 设为 true 支持多选。",
    inputSchema: clarifyInputSchema,
  })
}

/**
 * 注入 system prompt 的使用规则段（职责分层与 STYLE_LAYER_PREAMBLE 同思想：
 * 人格/任务指令要求直接输出时不问；用户显式要求优先）。
 */
export const CLARIFY_TOOL_PROMPT: string = [
  "## 澄清提问（ask_clarification 工具）",
  "- 用户提出任务/决策/推荐/写作类请求，且缺少会实质影响结果的关键信息（如预算、对象、场景、偏好、格式）时，调用 ask_clarification 一次提出 1-3 个问题，等用户回答后再正式作答",
  "- 每题给 2-4 个具体可点的选项并覆盖常见情形；选项写具体事实（如\"发给直属领导\"），不写抽象词（如\"工作用途\"）",
  "- 选项彼此不互斥、可同时成立时（并列偏好/多项需求，如\"想加强哪些模块\"），把该题 multiSelect 设为 true 允许用户多选；互斥的单选题保持默认",
  "- 调用工具时不要同时输出长篇正文，最多一句引入语；问题用用户提问所用的语言",
  "- 事实/知识/代码/翻译类问题、信息已足够、或任务可低成本返工时直接回答，不调用本工具",
  "- 收到用户的回答后直接基于答案执行任务，不再重复提问（除非答案本身引入新的关键歧义，此时最多再问一轮）",
  "- 对话最前方有人格设定（面具）且要求直接输出时，尊重人格设定，不调用本工具；用户消息里明确表达了偏好时以其为准",
].join("\n")
