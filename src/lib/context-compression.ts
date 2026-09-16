import { generateText, type LanguageModel, type ModelMessage } from "ai"
import { prisma } from "@/lib/db"

/**
 * 长上下文压缩: token 预算触发 + 滚动摘要。
 *
 * 设计要点:
 * - estimateMessagesTokens 用字符级粗估(中文×1.6 / 英文按词×1.3),
 *   误差在 ±20% 内,对"触发判断"够用,无需引入额外 tokenizer。
 * - 仅当累计长度超过 contextWindow × COMPRESS_THRESHOLD(默认 60%)时,
 *   才在 onFinish 里异步触发一次 LLM 摘要,把较早的若干轮压成 1 段文本。
 * - 摘要单独存到 ConversationSummary 表,每会话按时间序保留多个分代摘要;
 *   下次请求只读"最新一条",作为首条 system 注入,代替被压缩的原文。
 * - 失败兜底: 任何异常都不影响主聊天流程,静默回退到"全量发送"。
 */

/** 触发压缩的阈值(相对 contextWindow 的比例)。越低越早压缩、保留越少原文。 */
export const COMPRESS_THRESHOLD = 0.6

/** 触发压缩后,给输出预留的最大 token 预算(避免输出挤掉窗口)。 */
const RESERVED_OUTPUT_TOKENS = 4096

/** 摘要 LLM 输出的目标上限。 */
const SUMMARY_MAX_TOKENS = 600

/** 触发压缩后,"远期摘要 + 系统段"之外至少要保留的最近消息对数。 */
const MIN_RECENT_TURNS = 6

/** 触发压缩后,"远期摘要 + 系统段"之外至少要保留的最近消息对数上限。 */
const MAX_RECENT_TURNS = 16

/** 极短消息(如"你好")跳过摘要,避免无意义的 LLM 调用。 */
const MIN_USER_TEXT_LENGTH = 4

/**
 * 粗估 messages 的总 token 数。
 * 规则(误差 ≤ ±25%):
 * - 中文字符:每字约 1.6 token
 * - 英文/数字字符:按连续英文段拆分,每段 ≈ word×1.3 token,余字符按字符计
 * - 其他字符(标点/空白):每字符约 0.5 token
 *
 * 不追求精确,只用来判断"是否要压缩"。
 */
export function estimateMessagesTokens(messages: ModelMessage[]): number {
  let total = 0
  for (const m of messages) {
    const text = extractMessageText(m)
    if (!text) continue
    total += estimateTextTokens(text)
    // 每条消息 4 token 角色/分隔开销
    total += 4
  }
  return Math.ceil(total)
}

/** 估算单段文本的 token 数(粗估)。 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0

  let tokens = 0
  // 中文字符(CJK 统一汉字 + 常用标点)
  const cjkMatches = text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g)
  if (cjkMatches) tokens += cjkMatches.length * 1.6

  // 剩余字符:按连续英文段切分
  const remainder = text.replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, " ")
  const words = remainder.split(/\s+/).filter(Boolean)
  for (const w of words) {
    if (/^[a-zA-Z0-9_]+$/.test(w)) {
      // 长词按子词近似:每 4 字符 ≈ 1 token
      tokens += Math.max(1, Math.ceil(w.length / 4))
    } else {
      // 混合字符(标点、特殊符号):每字符 0.5
      tokens += w.length * 0.5
    }
  }
  return Math.ceil(tokens)
}

/** 从 ModelMessage 抽取全部文本(包含数组 content 中的 text part)。 */
function extractMessageText(m: ModelMessage): string {
  const c = (m as { content?: unknown }).content
  if (typeof c === "string") return c
  if (Array.isArray(c)) {
    return c
      .map((p) => {
        if (p && typeof p === "object" && "type" in p) {
          const part = p as { type?: string; text?: string }
          if (part.type === "text" && typeof part.text === "string") return part.text
        }
        return ""
      })
      .join("")
  }
  return ""
}

/**
 * 判断是否需要压缩。
 * @param messages 即将发送的 ModelMessage 列表(含 system 段)
 * @param contextWindow 模型最大上下文 token 数
 * @returns 是否触发压缩
 */
export function shouldCompress(
  messages: ModelMessage[],
  contextWindow: number
): boolean {
  if (!contextWindow || contextWindow <= 0) return false
  const used = estimateMessagesTokens(messages)
  // 阈值 = contextWindow × COMPRESS_THRESHOLD
  // 留出 RESERVED_OUTPUT_TOKENS 给模型输出
  const threshold = Math.max(
    1024,
    Math.floor(contextWindow * COMPRESS_THRESHOLD - RESERVED_OUTPUT_TOKENS)
  )
  return used >= threshold
}

/**
 * 决定压缩范围: 保留最近 N 对消息,前面的所有 user/assistant 消息参与压缩。
 * 返回的下标范围按 messages 数组的下标算(含 system 段)。
 *
 * 保留策略:
 * - 若消息总数 ≤ MIN_RECENT_TURNS × 2: 不压缩
 * - 否则保留最近 MAX_RECENT_TURNS 对,中间值线性插值
 */
export function decideCompressionRange(messages: ModelMessage[]): {
  recentStart: number
  olderStart: number
} | null {
  // 只算 user/assistant;system 永远保留
  const firstNonSystem = messages.findIndex((m) => m.role !== "system")
  if (firstNonSystem === -1) return null

  const convMsgs = messages.slice(firstNonSystem)
  if (convMsgs.length < MIN_RECENT_TURNS * 2) return null

  // 保留多少对:消息越多保留越少(给摘要更多空间)
  // 公式: pairs = clamp(MIN_RECENT_TURNS, MAX_RECENT_TURNS, 32 - log2(total/2))
  const totalPairs = Math.floor(convMsgs.length / 2)
  const recentPairs = Math.max(
    MIN_RECENT_TURNS,
    Math.min(MAX_RECENT_TURNS, Math.floor(MAX_RECENT_TURNS - Math.log2(totalPairs) * 2))
  )
  const recentMsgs = recentPairs * 2
  const recentStart = firstNonSystem + (convMsgs.length - recentMsgs)
  return {
    recentStart,
    olderStart: firstNonSystem,
  }
}

/**
 * 从 DB 读出该会话"最新一条"摘要(若有)。
 * 多代摘要的情况下,后续增强可读多条串起来;现阶段先读最新一条。
 */
export async function loadLatestSummary(
  conversationId: string
): Promise<{ content: string; rangeEnd: string; coveredMessages: number } | null> {
  try {
    const latest = await prisma.conversationSummary.findFirst({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      select: { content: true, rangeEnd: true, coveredMessages: true },
    })
    return latest
  } catch (err) {
    console.error("[compress] loadLatestSummary failed:", err)
    return null
  }
}

/**
 * 把摘要注入到 messages 列表的最前面(作为一条 system 消息)。
 * 若已有 system 段,合到第一条 system 的 content 里;否则新增一条 system。
 */
export function buildMessagesWithSummary(
  messages: ModelMessage[],
  summaryContent: string
): ModelMessage[] {
  const SUMMARY_HEADER =
    "## 早期对话摘要（系统自动压缩,可能不完整,不要引用其中未确认的具体数字/代码细节）"

  const wrappedSummary = `${SUMMARY_HEADER}\n${summaryContent}`

  // 找第一条 system
  const firstSystemIdx = messages.findIndex((m) => m.role === "system")
  if (firstSystemIdx === -1) {
    return [{ role: "system", content: wrappedSummary } as ModelMessage, ...messages]
  }
  // 合并到第一条 system 末尾
  const newMessages = messages.slice()
  const first = newMessages[firstSystemIdx]
  const origText = extractMessageText(first)
  const merged = origText ? `${origText}\n\n${wrappedSummary}` : wrappedSummary
  newMessages[firstSystemIdx] = { role: "system", content: merged } as ModelMessage
  return newMessages
}

/**
 * 从 messages 中找出 rangeEnd 之前的所有 user/assistant 消息
 * (用 Message.id 顺序匹配),生成原文片段,送 LLM 摘要。
 *
 * @param olderMessages 待压缩的 ModelMessage 子集
 * @param existingSummary 若已有更早的摘要,把它作为"前置上下文"告诉模型,避免重复
 */
async function summarizeOlderMessagesWithLLM(options: {
  model: LanguageModel
  olderMessages: ModelMessage[]
  existingSummary: string | null
}): Promise<string> {
  const { model, olderMessages, existingSummary } = options

  const transcript = olderMessages
    .map((m) => {
      const text = extractMessageText(m)
      if (!text) return ""
      const role = m.role === "user" ? "用户" : m.role === "assistant" ? "AI" : "系统"
      return `${role}: ${text}`
    })
    .filter(Boolean)
    .join("\n\n")

  // 极短原文直接当作摘要,省一次 LLM 调用
  if (transcript.length < 200) return transcript

  const prompt = `你是对话摘要助手。下面是一段较长的对话历史,请压缩成简洁的第三人称摘要。

要求:
1. 保留:用户身份/目标/关键决定、已学/已讨论的概念、未解决的问题、重要的实体名称
2. 省略:寒暄、重复确认、纯闲聊
3. 用中文,控制在 300 字以内,使用 Markdown 列表或短段落
4. 不要输出"以下是摘要"等套话,直接开始摘要内容

${existingSummary ? `【此前已有摘要(可作为前置上下文,避免重复)】
${existingSummary}

` : ""}【本次新增对话段落】
${transcript.slice(0, 16000)}

【输出】只输出摘要文本本身。`

  const result = await generateText({
    model,
    temperature: 0,
    maxOutputTokens: SUMMARY_MAX_TOKENS,
    prompt,
  })

  return result.text.trim()
}

/**
 * 把压缩后的摘要写回 DB,并打日志。
 * 失败抛错由调用方统一吞掉。
 */
async function saveSummary(options: {
  conversationId: string
  rangeStart: string | null
  rangeEnd: string
  content: string
  modelId: string
  coveredMessages: number
}): Promise<void> {
  await prisma.conversationSummary.create({
    data: {
      conversationId: options.conversationId,
      rangeStart: options.rangeStart,
      rangeEnd: options.rangeEnd,
      content: options.content,
      modelId: options.modelId,
      coveredMessages: options.coveredMessages,
    },
  })
}

/**
 * 完整流程: 在 onFinish 中异步触发。
 * 任何异常都被吞掉,绝不阻塞聊天主流程。
 *
 * 设计: 仅当该轮 user 消息文本够长时(MIN_USER_TEXT_LENGTH)才尝试摘要,
 * 避免对"你好""嗯"等闲聊触发 LLM 调用。
 *
 * @param force 手动压缩模式(用户点击"立即压缩"):跳过极短消息与阈值检查,
 *              但保留"消息太少无法压缩"的兜底,返回是否真正执行了压缩。
 */
export async function maybeCompressContext(options: {
  conversationId: string
  modelId: string
  model: LanguageModel
  /** 本轮新增 user 消息 id(用于标记 rangeEnd,可选) */
  userMessageId?: string
  /** 本轮新产生的 user/assistant 原文,参与压缩 */
  userText: string
  assistantText: string
  /** 模型 context window */
  contextWindow: number
  /** 该会话最近累计的消息数(由调用方从 DB 读出,避免再读一次) */
  totalMessages: number
  /** 手动压缩:跳过极短消息与阈值检查 */
  force?: boolean
}): Promise<boolean> {
  const {
    conversationId,
    modelId,
    model,
    userText,
    assistantText,
    contextWindow,
    totalMessages,
    force = false,
  } = options

  try {
    // 1) 极短消息跳过,减少无效调用(手动压缩不跳过)
    if (!force && userText.trim().length < MIN_USER_TEXT_LENGTH) return false
    if (!contextWindow || contextWindow <= 0) return false

    // 2) 达到触发阈值才压缩
    //    粗估:"本轮 user/assistant + 历史累计的 token"
    const thisTurnTokens = estimateTextTokens(userText) + estimateTextTokens(assistantText) + 8
    const estimatedTotal = thisTurnTokens * Math.max(1, Math.floor(totalMessages / 2))
    const threshold = Math.max(
      1024,
      Math.floor(contextWindow * COMPRESS_THRESHOLD - RESERVED_OUTPUT_TOKENS)
    )
    if (!force && estimatedTotal < threshold) {
      console.log(
        `[compress] skip: total≈${estimatedTotal} < threshold=${threshold} (conv=${conversationId})`
      )
      return false
    }

    // 3) 从 DB 读最近若干条消息原文(用于构造摘要输入)
    //    一次读 60 条(≈ 30 对),足够覆盖大多数压缩场景。
    const recentMessages = await prisma.message.findMany({
      where: { conversationId, archived: false, role: { in: ["user", "assistant"] } },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: { id: true, role: true, content: true, createdAt: true },
    })
    // 倒序读出来后反转回时间正序
    recentMessages.reverse()
    if (recentMessages.length < MIN_RECENT_TURNS * 2) return false

    // 4) 决定压缩范围: 保留最近 N 对,前面的全部参与压缩
    const keepPairs = Math.max(
      MIN_RECENT_TURNS,
      Math.min(
        MAX_RECENT_TURNS,
        Math.floor(MAX_RECENT_TURNS - Math.log2(recentMessages.length / 2) * 2)
      )
    )
    const keepMsgs = keepPairs * 2
    const older = recentMessages.slice(0, recentMessages.length - keepMsgs)
    if (older.length === 0) return false

    // 5) 读已有"最新摘要",作为前置上下文传给 LLM
    const existingSummary = await loadLatestSummary(conversationId)

    // 6) 调 LLM 生成新摘要
    const olderModelMessages: ModelMessage[] = older.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }))

    const t0 = Date.now()
    const newSummary = await summarizeOlderMessagesWithLLM({
      model,
      olderMessages: olderModelMessages,
      existingSummary: existingSummary?.content ?? null,
    })
    console.log(
      `[compress] generated summary in ${Date.now() - t0}ms ` +
        `(${older.length} msgs -> ${newSummary.length} chars, conv=${conversationId})`
    )

    // 7) 落库
    await saveSummary({
      conversationId,
      rangeStart: older[0].id,
      rangeEnd: older[older.length - 1].id,
      content: newSummary,
      modelId,
      coveredMessages: older.length,
    })
    console.log(`[compress] saved summary for conv=${conversationId}`)
    return true
  } catch (err) {
    // 压缩失败不影响主聊天流程
    console.error("[compress] failed:", err)
    return false
  }
}
