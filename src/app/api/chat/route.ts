import { NextRequest } from "next/server"
import {
  streamText,
  wrapLanguageModel,
  extractReasoningMiddleware,
  toUIMessageStream,
  createUIMessageStreamResponse,
  APICallError,
  stepCountIs,
  type ModelMessage,
  type UIMessageChunk,
} from "ai"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/crypto"
import { getEffectiveModel, createProviderInstanceForEffectiveModel } from "@/lib/ai/registry"
import { buildCustomModelDefinition, resolveApiKey, createCustomLanguageModel } from "@/lib/ai/custom-model"
import { buildMemorySystemPrompt, getRelevantMemories, extractAndSaveMemories } from "@/lib/memory"
import { generateImage, extractImagePrompts, IMG_MARKER_REGEX } from "@/lib/ai/image"
import { generateConversationTitle } from "@/lib/ai/title-generator"
import { getStylePromptFromPreset, STYLE_PRESETS, presetFromOffset } from "@/lib/ai/style"
import { getMaskById } from '@/lib/ai/mask-resolve'
import { MASK_ESCAPE_HATCH } from '@/lib/ai/mask-types'
import { splitReasoningTail } from "@/lib/utils"
import { createWebSearchTool } from "@/lib/ai/search"
import { loadLatestSummary, maybeCompressContext } from "@/lib/context-compression"
import type { SearchEngineId } from "@/lib/ai/search-engines"
import type { Attachment } from "@/lib/attachment-types"
import { sanitizeUploadName, readUploadAsDataUrl } from "@/lib/uploads"
import { SCANNED_PDF_MIN_CHARS } from "@/lib/file-parser"
import type { ModelDefinition } from "@/lib/ai/types"

export const maxDuration = 120 // seconds – 深度思考耗时较长,Vercel Pro 允许到 300

interface ChatRequestBody {
  model: string
  messages: IncomingMessage[]
  conversationId?: string
  deepThink?: boolean
  groupId?: string
  attachments?: Attachment[]
  styleOffset?: number // 旧版 0-100, default 50 if not provided(向后兼容)
  stylePreset?: string // 新版 preset id(balanced/practical/dev/editor/mentor/scholar)
  maskId?: string // 面具 id(内置面具见 @/lib/ai/builtin-masks);不传时从会话读取
  webSearch?: boolean // 客户端本次请求是否开启联网搜索
  searchEngine?: SearchEngineId // 联网搜索引擎，默认 qianfan
}

/** 客户端传入的消息（UIMessage 格式的结构化子集） */
interface IncomingPart {
  type: string
  text?: string
}

interface IncomingMessage {
  role: string
  content?: string | IncomingPart[]
  parts?: IncomingPart[]
  text?: string
  /** 后端写入的结构化 UI 提示: { kind: 'branch_summary', ... } */
  metadata?: unknown
}

/**
 * Convert incoming UIMessage format (from @ai-sdk/react useChat) to ModelMessage format
 * that streamText expects. UIMessages use `parts` array; ModelMessages use `content`.
 */
function convertToModelMessages(messages: IncomingMessage[]): ModelMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
    .map((m) => {
      let textContent = ""
      // If message already has string content, use it directly
      if (typeof m.content === "string" && m.content) {
        textContent = m.content
      } else if (Array.isArray(m.content) && m.content.length > 0) {
        // content is already structured parts — pass through
        const result = { role: m.role, content: m.content } as unknown as ModelMessage
        if (m.metadata) (result as { metadata?: unknown }).metadata = m.metadata
        return result
      } else if (Array.isArray(m.parts)) {
        textContent = m.parts
          .filter((p: IncomingPart) => p.type === "text")
          .map((p: IncomingPart) => p.text ?? "")
          .join("")
      } else {
        textContent = String(m.content ?? m.text ?? "")
      }
      const result = { role: m.role, content: textContent } as ModelMessage
      // Preserve metadata so downstream code can identify special message kinds
      // (e.g. branch_summary system messages that must be moved into the `system` param).
      if (m.metadata) (result as { metadata?: unknown }).metadata = m.metadata
      return result
    })
    .filter((m) => m.content !== "")
}

const IMG_PREFIX = "[IMG:"
const IMG_PLACEHOLDER = "\n\n> 🎨 正在生成图片…\n\n"

/**
 * 过滤流式输出中的 [IMG:...] 标记(跨 chunk 安全),替换为占位提示。
 * 最终正文在 onFinish 中统一替换为真实图片后入库,
 * 客户端收到 finish 事件时会拉取库中最终内容覆盖显示。
 */
function createImgMarkerFilterStream(): TransformStream<UIMessageChunk, UIMessageChunk> {
  let pending = ""

  // 计算 buf 末尾与 IMG_PREFIX 前缀的最长重叠长度(标记可能被 chunk 截断)
  const longestPrefixAtEnd = (s: string): number => {
    for (let len = IMG_PREFIX.length; len > 0; len--) {
      if (s.endsWith(IMG_PREFIX.slice(0, len))) return len
    }
    return 0
  }

  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (chunk.type !== "text-delta") {
        controller.enqueue(chunk)
        return
      }
      let buf = pending + chunk.delta
      pending = ""

      // 逐个替换完整的 [IMG:...] 标记;未闭合的标记挂起等待后续 chunk
      while (true) {
        const startIdx = buf.indexOf(IMG_PREFIX)
        if (startIdx === -1) {
          const hold = longestPrefixAtEnd(buf)
          if (hold > 0) {
            pending = buf.slice(buf.length - hold)
            buf = buf.slice(0, buf.length - hold)
          }
          break
        }
        const endIdx = buf.indexOf("]", startIdx)
        if (endIdx === -1) {
          pending = buf.slice(startIdx)
          buf = buf.slice(0, startIdx)
          break
        }
        buf = buf.slice(0, startIdx) + IMG_PLACEHOLDER + buf.slice(endIdx + 1)
      }

      if (buf) {
        controller.enqueue({ type: "text-delta", id: chunk.id, delta: buf })
      }
    },
    flush() {
      // 流结束时仍有未闭合标记(模型输出被截断),直接丢弃;
      // 最终入库内容在 onFinish 中会同样清理残留标记。
    },
  })
}

/** Extract plain text from a message (UIMessage or CoreMessage) */
function extractTextContent(msg: IncomingMessage): string {
  if (typeof msg.content === "string" && msg.content) return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((p: IncomingPart) => p.type === "text")
      .map((p: IncomingPart) => p.text ?? "")
      .join("\n")
  }
  if (Array.isArray(msg.parts)) {
    return msg.parts
      .filter((p: IncomingPart) => p.type === "text")
      .map((p: IncomingPart) => p.text ?? "")
      .join("\n")
  }
  return String(msg.content ?? msg.text ?? "")
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    }

    const userId = session.user.id

    // 提前声明:长上下文摘要注入分支及多处 system 提示都需要读写 systemParts,
    // 在函数顶部集中声明一次,避免下游块式作用域里的 TDZ / use-before-define。
    const systemParts: string[] = []

    const body: ChatRequestBody = await req.json()
    const { model: modelId, messages: rawMessages, conversationId, deepThink, groupId, webSearch, searchEngine } = body
    const attachments = Array.isArray(body.attachments) ? body.attachments : []
    const hasImageAttachments = attachments.some((a) => a.type.startsWith("image/"))

    console.log(`[chat] Processing request for user ${userId}, model: ${modelId}, messages: ${rawMessages?.length || 0}, deepThink: ${deepThink}, webSearch: ${webSearch}`)

    // 新版 preset 优先:body 显式传 stylePreset 时用之;否则从 DB 读 preset;
    // preset 缺失/null 时,回退到旧的 styleOffset(老会话);offset 也无则默认 balanced。
    const requestedStylePreset = STYLE_PRESETS.find((p) => p.id === body.stylePreset)?.id
    const requestedStyleOffset =
      typeof body.styleOffset === 'number' && Number.isFinite(body.styleOffset)
        ? Math.max(0, Math.min(100, Math.round(body.styleOffset)))
        : undefined

    // 解析面具:body 显式传 maskId 时用之;否则从 DB 读;未知 id 视为无面具。
    // user: 前缀为自定义面具(getMaskById 内部校验归属)
    const requestedMask = await getMaskById(body.maskId ?? null, userId)
    const requestedMaskRef = requestedMask?.ref

    let conversationStylePreset: string | null = null
    let conversationStyleOffset = 50
    let conversationMaskId: string | null = null
    if (conversationId) {
      try {
        const conv = await prisma.conversation.findFirst({
          where: { id: conversationId, userId },
          select: { styleOffset: true, stylePreset: true, maskId: true },
        })
        conversationStylePreset = conv?.stylePreset ?? null
        conversationStyleOffset = conv?.styleOffset ?? 50
        conversationMaskId = conv?.maskId ?? null
      } catch (err) {
        console.error("[chat] Failed to fetch conversation:", err)
      }
    }

    // 解析最终生效的面具:body > DB conv;未知 id 视为无面具
    const effectiveMask = await getMaskById(requestedMaskRef ?? conversationMaskId, userId)
    const effectiveMaskId = effectiveMask?.ref ?? null
    if (effectiveMask) {
      console.log(`[chat] Mask: ${effectiveMask.ref} (body: ${requestedMaskRef ?? '-'}, conv: ${conversationMaskId ?? '-'})`)
    }

    // 解析最终生效的 preset:body > DB preset > 面具默认风格 > 由 offset 推导 > balanced
    const effectiveStylePreset: string =
      requestedStylePreset ??
      conversationStylePreset ??
      effectiveMask?.stylePreset ??
      presetFromOffset(requestedStyleOffset ?? conversationStyleOffset)
    console.log(`[chat] Style preset: ${effectiveStylePreset} (body: ${requestedStylePreset ?? '-'}, conv: ${conversationStylePreset ?? '-'})`)

  // Validate model (builtin or custom)
  let modelDef: ModelDefinition
  let apiKey: string | undefined
  let provider: (modelId: string) => ReturnType<typeof createProviderInstanceForEffectiveModel>
  let realModelId = modelId // for builtin models same as input; for custom use modelId from DB

  if (modelId.startsWith("custom:")) {
    const cmId = modelId.slice(7) // strip "custom:" prefix
    const cmRecord = await prisma.customModel.findFirst({ where: { id: cmId, userId } })
    if (!cmRecord) {
      console.error(`[chat] Unknown custom model: ${modelId} for user ${userId}`)
      return new Response(JSON.stringify({ error: `Unknown custom model: ${modelId}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }
    modelDef = buildCustomModelDefinition(cmRecord)
    realModelId = cmRecord.modelId
    // Resolve API key (own key > provider key > none/local)
    apiKey = await resolveApiKey(userId, cmRecord)
    // Build provider instance (native for provider-key reuse without baseURL; OpenAI-compatible otherwise)
    provider = () => createCustomLanguageModel(cmRecord, apiKey)
  } else {
    // 用户级有效模型：内置预置（未被该用户隐藏）+ 用户添加的自定义模型（复用 provider Key）
    const builtinModelDef = await getEffectiveModel(userId, modelId)
    if (!builtinModelDef) {
      console.error(`[chat] Unknown model: ${modelId}`)
      return new Response(JSON.stringify({ error: `Unknown model: ${modelId}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }
    modelDef = builtinModelDef

    // Fetch and decrypt the user's API key for this provider
    const apiKeyRecord = await prisma.apiKey.findUnique({
      where: {
        userId_provider: {
          userId,
          provider: modelDef.provider,
        },
      },
    })

    // For Qwen/DashScope: fall back to environment variable API key if user hasn't configured one
    // This enables free-tier access without requiring users to manually configure API keys
    if (!apiKeyRecord && modelDef.provider === "qianwen") {
      apiKey = process.env.API_KEY_DASHSCOPE
      if (!apiKey) {
        console.error(`[chat] No DashScope API key configured for user ${userId}`)
        return new Response(
          JSON.stringify({ error: `DashScope API key not configured in server environment variables (API_KEY_DASHSCOPE)` }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
      }
      console.log("[chat] Using DashScope env var API key for Qwen models")
    } else if (!apiKeyRecord) {
      console.error(`[chat] No API key configured for ${modelDef.provider} for user ${userId}`)
      return new Response(
        JSON.stringify({ error: `No API key configured for ${modelDef.provider}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    } else {
      try {
        apiKey = decrypt(apiKeyRecord.encryptedKey)
      } catch (err) {
        console.error(`[chat] Failed to decrypt API key for user ${userId}:`, err)
        return new Response(
          JSON.stringify({ error: `Failed to decrypt API key` }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        )
      }
    }

    try {
      // 用户添加的模型（非 custom: 前缀）使用 modelDef.provider 查找 provider
      provider = createProviderInstanceForEffectiveModel(modelDef, apiKey)
    } catch (err) {
      console.error(`[chat] Failed to create provider instance for ${modelId}:`, err)
      return new Response(
        JSON.stringify({ error: `Failed to initialize AI provider` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      )
    }
  }

  // Convert incoming messages to ModelMessage format for streamText
  let messages = convertToModelMessages(rawMessages)

  // 附件内容注入:图片转多模态 image part(仅视觉模型),文本文件读入正文
  if (attachments.length > 0) {
    const userMsgIdx = messages.map((m) => m.role).lastIndexOf("user")
    if (userMsgIdx !== -1) {
      type ContentPart = { type: string; text?: string; image?: unknown }
      const contentParts: ContentPart[] = []
      for (const att of attachments) {
        const fileName = sanitizeUploadName(att.url)
        if (!fileName) continue
        if (att.type.startsWith("image/")) {
          if (modelDef.supportsVision) {
            const dataUrl = await readUploadAsDataUrl(fileName, att.type)
            if (dataUrl) {
              contentParts.push({ type: "image", image: dataUrl })
            }
          } else {
            contentParts.push({
              type: "text",
              text: `（用户上传了一张图片「${att.name}」，但你无法查看图片内容。请直接告诉用户：你无法查看图片，需要切换到支持视觉的模型后重新发送；不要尝试描述、猜测或生成图片。）`,
            })
          }
        } else {
          // 文本/PDF:从中转站(UploadFile)取上传时解析好的文本,不再读盘重复解析
          const rec = await prisma.uploadFile
            .findUnique({ where: { fileName } })
            .catch(() => null)
          if (
            rec?.parseStatus === "done" &&
            rec.parseText &&
            rec.parseText.trim().length >= SCANNED_PDF_MIN_CHARS
          ) {
            // 截断超长文本,避免撑爆上下文
            const truncated = rec.parseText.length > 20000
            const text = rec.parseText.slice(0, 20000)
            contentParts.push({
              type: "text",
              text: `【附件 ${att.name}】\n${text}${
                truncated ? "\n（内容过长，已截断前 20000 字符）" : ""
              }`
            })
          } else if (rec?.parseStatus === "done") {
            // done 但提取不到有效文本:扫描件/图片型 PDF
            contentParts.push({
              type: "text",
              text: `（用户上传的 PDF「${att.name}」是扫描版/图片型，未能提取到文本。请告诉用户：扫描版 PDF 暂无法阅读，建议提供文字版，或在设置中切换到支持视觉的模型。）`,
            })
          } else if (rec) {
            // failed 等异常状态
            contentParts.push({
              type: "text",
              text: `（用户上传的文件「${att.name}」解析失败，无法读取内容。请直接告知用户该附件无法处理。）`,
            })
          } else {
            contentParts.push({
              type: "text",
              text: `（用户上传了文件 ${att.name}，当前版本暂不支持解析该类型）`,
            })
          }
        }
      }
      if (contentParts.length > 0) {
        const orig = messages[userMsgIdx].content
        if (typeof orig === "string" && orig) {
          contentParts.push({ type: "text", text: orig })
        }
        messages[userMsgIdx] = {
          role: "user",
          content: contentParts,
        } as ModelMessage
      }
    }
  }

  // 长上下文压缩: 如果该会话已有"远期摘要",在 messages 头部注入一条 system
  // (即用摘要替代之前被压缩掉的早期原文,避免长对话撞模型 contextWindow)
  if (conversationId) {
    try {
      const latestSummary = await loadLatestSummary(conversationId)
      if (latestSummary?.content) {
        const SUMMARY_HEADER =
          "## 早期对话摘要（系统自动压缩,可能不完整,不要引用其中未确认的具体数字/代码细节）"
        systemParts.unshift(`${SUMMARY_HEADER}\n${latestSummary.content}`)
        console.log(
          `[chat] injected summary (${latestSummary.content.length} chars, covered ${latestSummary.coveredMessages} msgs) for conv ${conversationId}`
        )
      }
    } catch (err) {
      console.error("[chat] Failed to inject summary:", err)
    }
  }

  // Extract text from the last user message for persistence & memory relevance
  const lastRawUserMsg = [...rawMessages].reverse().find((m) => m.role === "user")
  const userContent = lastRawUserMsg ? extractTextContent(lastRawUserMsg) : ""

  // Load the user's long-term memories (if the feature is enabled)
  const memorySettings = await prisma.user.findUnique({
    where: { id: userId },
    select: { memoryEnabled: true, clarifyEnabled: true },
  })
  const memoryEnabled = memorySettings?.memoryEnabled ?? true
  const clarifyEnabled = memorySettings?.clarifyEnabled ?? true

  let memorySystemPrompt = ""
  if (memoryEnabled) {
    const memories = await prisma.memory.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    })
    if (memories.length > 0) {
      const relevant = getRelevantMemories(memories, userContent || "")
      memorySystemPrompt = buildMemorySystemPrompt(relevant)
    }
  }

  // 自助反问:告诉模型在缺少关键信息时先提问,而不是直接下结论
  const clarifySystemPrompt = [
    '## 自助反问',
    '用户提出个人决策/推荐类问题（如"我该选哪个""适不适合买 X"）且缺少关键信息时，先提 2-4 个简短问题再作答：编号列表、用用户语言、覆盖预算/场景/现状等关键维度。最多追问两轮、不重复已问的问题，两轮后必须给出结论并说明假设。',
    '事实/知识/代码/翻译类问题，或信息已足够时直接回答，不要反问。',
  ].join('\n')

  // Deep thinking: for non-reasoning models, add a system prompt and extract thinking via middleware
  let model = provider(realModelId)
  const baseModel = model // 保留原始模型引用，用于标题生成等后台任务
  if (memorySystemPrompt) systemParts.push(memorySystemPrompt)
  if (clarifyEnabled) systemParts.push(clarifySystemPrompt)

  // Style prompt - 用 preset 渲染(新版)
  systemParts.push(getStylePromptFromPreset(effectiveStylePreset))

  // Image generation — tell the model how to request images
  // 非视觉模型收到图片附件时移除生图能力提示,避免模型被"图片"字眼诱导误触发生图
  if (!(hasImageAttachments && !modelDef.supportsVision)) {
    systemParts.push([
      '## 生图能力',
      '用户想要生成图片时，在图片应出现的位置输出 [IMG:详细描述]（用用户语言描述主体、风格、构图、光线），每条回复最多 2 张。',
    ].join('\n'))
  }

  // 联网搜索能力(仅在用户配置了联网搜索 Key 且本次请求主动开启了 webSearch 时才挂上工具)
  // - webSearchEnabled: 客户端本次是否主动开启(默认 false,避免模型无脑触发搜索消耗额度)
  // - 引擎: 客户端通过 searchEngine 指定(qianfan | tavily)，由 Settings 滑块控制
  const webSearchEnabled = webSearch === true
  const engine: SearchEngineId = searchEngine ?? "qianfan"
  let searchApiKey: string | null = null
  // 工具调用明细收集:onStepFinish 逐步累积,流结束后随 metadata 入库,
  // 供前端历史消息回显工具调用卡片(kind='tool_calls')。
  const collectedToolCalls: Array<{ tool: string; input: unknown; output: unknown }> = []
  let searchTool: ReturnType<typeof createWebSearchTool> | null = null
  if (webSearchEnabled) {
    try {
      const searchKeyRecord = await prisma.searchApiKey.findUnique({
        where: { userId_engine: { userId, engine } },
      })
      if (searchKeyRecord) {
        searchApiKey = decrypt(searchKeyRecord.encryptedKey)
        searchTool = createWebSearchTool(engine, searchApiKey)
        console.log(`[chat] Using search engine: ${engine}`)
      }
    } catch (err) {
      console.error(`[chat] Failed to load search key for engine ${engine}:`, err)
    }
    if (!searchApiKey) {
      console.warn(`[chat] User ${userId} requested webSearch but no SearchApiKey configured for engine '${engine}'`)
    }
  }
  if (searchTool) {
    const engineDisplayName = engine === "tavily" ? "Tavily" : "百度千帆"
    systemParts.push([
      '## 联网搜索能力',
      `你拥有 web_search 工具(基于 ${engineDisplayName} 搜索 API)。当用户问题涉及以下场景时,**主动调用 web_search** 一次或多次获取实时信息再作答:`,
      '- 询问新闻、事件、近期发生的事("今天/最新/最近"+时间词)',
      '- 需要事实性数据(股价、天气、比赛结果、排行榜、版本号等)',
      '- 引用具体来源、查证知识、用户要求"查一下"',
      '- 你对某个事实没有把握、训练数据可能已过时',
      '普通闲聊、通用知识问答、代码/翻译/数学等不需要联网。回答时请自然引用来源，不要编造链接。',
    ].join('\n'))
  }
  console.log(`[chat] webSearchEnabled=${webSearchEnabled}, engine=${engine}, searchApiKey=${searchApiKey ? 'loaded' : 'null'}, tools=${searchTool ? 'web_search attached' : 'no tools'}`)

  // Always enable reasoning extraction for models that support it or deepThink is enabled
  const shouldExtractReasoning = deepThink || modelDef.supportsReasoning
  
  if (shouldExtractReasoning) {
    // Add thinking prompt for non-reasoning models
    if (!modelDef.supportsReasoning) {
      systemParts.push(
        [
          'You are a thoughtful AI assistant. You MUST think step by step before giving the final answer.',
          'Format your response EXACTLY as follows:',
          '- Put your ENTIRE reasoning process inside one pair of <think> and </think> tags, with nothing else inside.',
          '- Put your final answer AFTER the closing </think> tag, on its own.',
          '- Do NOT skip the tags, do NOT use any other tag name, and do NOT put reasoning outside the tags.',
          'Example:',
          '<think>First, ... Then, ... Therefore, ...</think>',
          'Final answer here.',
        ].join('\n')
      )
    }

    // Apply reasoning extraction middleware for models that need it (not DeepSeek native)
    // DeepSeek's deepseek-reasoner has NATIVE reasoning_content support via API
    // Third-party providers (Fireworks, Groq, Together, etc.) require extractReasoningMiddleware
    const isDeepSeekNativeReasoning = modelDef.provider === 'deepseek' && modelDef.supportsReasoning
    if (!isDeepSeekNativeReasoning) {
      model = wrapLanguageModel({
        model,
        middleware: extractReasoningMiddleware({ tagName: 'think' }),
      })
    }
  }

  // Ensure a conversation exists
  let convId = conversationId
  let isNewConversation = false

  // A 流式恢复: 单聊(非对比)在生成开始前落一条 streaming 草稿行,
  // 流式期间节流快照已生成文本,刷新/换端后客户端轮询续显,
  // onFinish 定格为最终内容。快照写入经 snapChain 串行化,
  // 保证在途快照先落地、最终落库后执行,避免旧快照覆盖最终内容。
  let draftMessageId: string | null = null
  let snapText = ""
  let snapReasoning = ""
  let lastSnapAt = 0
  let snapStopped = false
  let snapChain: Promise<void> = Promise.resolve()
  const scheduleDraftSnapshot = (): void => {
    if (!draftMessageId || snapStopped) return
    snapChain = snapChain
      .then(async () => {
        if (!draftMessageId || snapStopped) return
        try {
          await prisma.message.update({
            where: { id: draftMessageId },
            data: { content: snapText, reasoning: snapReasoning || null },
          })
          lastSnapAt = Date.now()
        } catch {
          // 快照失败不影响流式主流程
        }
      })
      .catch(() => {})
  }
  if (!convId) {
    const conv = await prisma.conversation.create({
      data: {
        userId,
        title: userContent.slice(0, 40) || "新对话",
        model: modelId,
        stylePreset: effectiveStylePreset,
        ...(effectiveMaskId ? { maskId: effectiveMaskId } : {}),
        ...(groupId ? { mode: "compare" } : {}),
      },
    })
    convId = conv.id
    isNewConversation = true
  }

  // Persist the last user message before streaming
  if (userContent) {
    if (groupId) {
      // 对比模式: N 个泳道并发到达,事务内查重防止同一条用户消息入库多次
      await prisma.$transaction(async (tx) => {
        const existing = await tx.message.findFirst({
          where: { conversationId: convId, groupId, role: "user" },
          select: { id: true },
        })
        if (!existing) {
          await tx.message.create({
            data: {
              conversationId: convId,
              role: "user",
              content: userContent,
              groupId,
              ...(attachments.length > 0
                ? { attachments: JSON.stringify(attachments) }
                : {}),
            },
          })
        }
      })
    } else {
      // C 分支轻量版: 编辑产生的新 user 消息带 editedFrom 指向被编辑消息,
      // 供前端"查看历史版本"回看入口使用(仅写入该字段,不透传任意 metadata)
      const editedFrom = (
        lastRawUserMsg?.metadata as { editedFrom?: unknown } | undefined
      )?.editedFrom
      await prisma.message.create({
        data: {
          conversationId: convId,
          role: "user",
          content: userContent,
          ...(attachments.length > 0
            ? { attachments: JSON.stringify(attachments) }
            : {}),
          ...(typeof editedFrom === "string" && editedFrom
            ? { metadata: JSON.stringify({ editedFrom }) }
            : {}),
        },
      })
    }
  }

  // A 流式恢复: 单聊时生成开始前先落草稿行(失败不阻塞对话)。
  // 放在用户消息落库之后,保证列表时序:用户消息在前,草稿行在后。
  if (!groupId) {
    try {
      const draft = await prisma.message.create({
        data: {
          conversationId: convId!,
          role: "assistant",
          content: "",
          model: modelId,
          streaming: true,
        },
      })
      draftMessageId = draft.id
    } catch (err) {
      console.error("[chat] Failed to create streaming draft message:", err)
    }
  }

  // AI SDK v7 forbids system messages inside the `messages` array.
  // Filter them out here; the compression summary (if any) is prepended to
  // systemParts and received by the model via the `system` param instead.
  // Branch-summary system messages are mirrored into systemParts first so the
  // LLM actually sees the upstream context, then dropped from the messages
  // array (the frontend still renders the summary card from DB metadata).
  let branchSummaryInjected = 0
  const llmMessages = messages.filter((m) => {
    if (m.role !== "system") return true
    const meta = (m as { metadata?: unknown }).metadata
    if (
      meta &&
      typeof meta === "object" &&
      (meta as Record<string, unknown>).kind === "branch_summary" &&
      typeof m.content === "string" &&
      m.content.trim()
    ) {
      // 分支 API 写入的内容已包含 "## 来自上文的上下文摘要(系统自动生成)" 头,
      // 这里直接 unshift,避免重复标题
      systemParts.unshift(m.content)
      branchSummaryInjected++
      return false
    }
    // 其他 system 消息(用户手写或其他来源):同样不喂给 LLM,避免 SDK 报错
    return false
  })
  if (branchSummaryInjected > 0) {
    console.log(`[chat] injected ${branchSummaryInjected} branch_summary into system prompt`)
  }
  // Mask persona:面具人格放最前(人格层优先于摘要/记忆/风格/能力说明)。
  // 末尾统一追加逃生舱暗号(见 MASK_ESCAPE_HATCH),内置与自定义面具都适用
  if (effectiveMask) {
    systemParts.unshift(`${effectiveMask.systemPrompt}\n\n${MASK_ESCAPE_HATCH}`)
    console.log(`[chat] Mask persona injected: ${effectiveMask.ref}`)
  }

  // systemParts 可能被上面 unshift 过,重新 join
  const finalSystem = systemParts.length > 0 ? systemParts.join('\n\n') : undefined

  // Mask few-shot:预设对话示例插在真实消息之前。
  // 拼装发生在上下文压缩之后,不会被压缩统计/吞掉。
  const maskFewShotMessages: ModelMessage[] = (effectiveMask?.fewShot ?? []).map((turn) => ({
    role: turn.role,
    content: turn.content,
  }))

  // Stream the response
  const result = streamText({
    model,
    messages: maskFewShotMessages.length > 0 ? [...maskFewShotMessages, ...llmMessages] : llmMessages,
    ...(finalSystem ? { system: finalSystem } : {}),
    ...(searchTool ? { tools: { web_search: searchTool } } : {}),
    // 让模型能"思考 → 调工具 → 拿到结果 → 继续生成最终答案",
    // 默认 stepCountIs(1) 会在调完一次工具后立刻停下,无法完成多步链式调用。
    stopWhen: stepCountIs(5),
    // A 流式恢复: 累积快照文本并节流(600ms)写库。
    // 注意: onChunk 返回 Promise 会暂停流处理,这里保持同步 + fire-and-forget。
    // AI SDK v7 中 text-delta / reasoning-delta 的文本字段为 `text`。
    onChunk: ({ chunk }) => {
      const c = chunk as { type?: string; text?: unknown }
      if (c.type === "text-delta" && typeof c.text === "string") {
        snapText += c.text
      } else if (c.type === "reasoning-delta" && typeof c.text === "string") {
        snapReasoning += c.text
      }
      if (draftMessageId && Date.now() - lastSnapAt > 600) {
        scheduleDraftSnapshot()
      }
    },
    onStepFinish: ({ stepType, toolCalls, toolResults, finishReason }: { stepType?: string; toolCalls?: unknown[]; toolResults?: unknown[]; finishReason?: string }) => {
      console.log(`[chat] step finished: type=${stepType}, toolCalls=${toolCalls?.length ?? 0}, toolResults=${toolResults?.length ?? 0}, finishReason=${finishReason}`)
      // 收集工具调用与结果(AI SDK v7: call={toolCallId,toolName,input}, result={toolCallId,output})
      const stepResults = Array.isArray(toolResults) ? toolResults : []
      for (const call of Array.isArray(toolCalls) ? toolCalls : []) {
        const c = call as { toolCallId?: string; toolName?: string; input?: unknown }
        const r = stepResults.find((x) => (x as { toolCallId?: string }).toolCallId === c.toolCallId) as
          | { output?: unknown; result?: unknown }
          | undefined
        collectedToolCalls.push({
          tool: c.toolName ?? 'unknown',
          input: c.input ?? null,
          output: r ? (r.output ?? r.result ?? null) : null,
        })
      }
    },
    onFinish: async ({ text, reasoningText, finishReason, usage }) => {
      // 诊断日志:记录流异常结束,便于排查偶发"模型没思考"问题
      if (finishReason === 'length' || finishReason === 'error') {
        console.warn(
          `[chat] ABNORMAL_FINISH: reason=${finishReason}, model=${modelId}, hasText=${!!text}, hasReasoning=${!!reasoningText}, textLen=${text?.length ?? 0}, reasoningLen=${reasoningText?.length ?? 0}`
        )
      }

      // 流出错且无任何内容时不落库,避免历史中出现空白助手消息。
      // A 流式恢复: 先等在途快照落地,草稿行已有快照内容则定格保留,
      // 完全为空则删除,不留空白消息或永久 streaming 的残留行。
      if (finishReason === 'error' && !text && !reasoningText) {
        snapStopped = true
        await snapChain
        if (draftMessageId) {
          if (snapText.trim() || snapReasoning.trim()) {
            await prisma.message
              .update({ where: { id: draftMessageId }, data: { streaming: false } })
              .catch(() => {})
          } else {
            await prisma.message.delete({ where: { id: draftMessageId } }).catch(() => {})
          }
        }
        return
      }

      // Ensure content is always a non-null string (Prisma schema requires String, not String?)
      let content = text ?? ""
      let savedReasoning = reasoningText ?? null

      // 截断提示:输出被 token 上限截断时,告知用户可换模型或缩短上下文
      if (finishReason === 'length' && content) {
        content = content + '\n\n…(输出被 token 上限截断,可考虑换模型或缩短上下文)…'
      }

      // 诊断:深度思考模式下,若两者都为空,说明模型真的没输出思考
      if (deepThink && !content.trim() && !savedReasoning?.trim()) {
        console.warn(`[chat] DEEP_THINK_EMPTY: model=${modelId}, deepThink=true but both text and reasoning are empty`)
      }
      if (deepThink && savedReasoning) {
        console.log(`[chat] DEEP_THINK_OK: model=${modelId}, reasoningLen=${savedReasoning.length}, contentLen=${content.length}`)
      }

      // 兜底:模型把全部内容(含最终答案)都放进了 <think> 标签,导致正文为空。
      // 此时从推理尾部拆出答案部分作为正文,避免用户只看到思考过程而没有任何回答。
      if (!content.trim() && savedReasoning?.trim()) {
        const { head, tail } = splitReasoningTail(savedReasoning)
        content = tail
        savedReasoning = head || null
        if (content) {
          console.log(`[chat] FALLBACK_SPLIT: model=${modelId}, extracted answer from reasoning tail (reasoningLen=${savedReasoning?.length ?? 0}, contentLen=${content.length})`)
        }
      }

      // 检测 [IMG:...] 标记并调用生图(自动根据用户选择的模型分发)
      const imagePrompts = extractImagePrompts(content)
      if (imagePrompts.length > 0) {
        const userRecord = await prisma.user.findUnique({
          where: { id: userId },
          select: { imageModel: true, imageSize: true },
        })
        const modelId = userRecord?.imageModel ?? "builtin:wanx2.1-t2i-turbo"
        const size = userRecord?.imageSize ?? "1024*1024"

        const replacements: string[] = []
        for (const prompt of imagePrompts) {
          try {
            const result = await generateImage(userId, modelId, prompt, size)
            replacements.push(`![${prompt}](${result.url})`)
            // 归档到生图历史库(source=chat),失败不阻塞对话保存
            prisma.generatedImage
              .create({
                data: {
                  userId,
                  prompt,
                  url: result.url,
                  model: result.model,
                  width: result.width,
                  height: result.height,
                  source: "chat",
                },
              })
              .catch((err) => {
                console.error("[chat] Failed to archive generated image:", err)
              })
          } catch (err) {
            const reason = err instanceof Error ? err.message : "未知原因"
            console.error("[chat] Image generation failed:", reason)
            replacements.push(`> ⚠️ 图片生成失败:${reason.replace(/\s+/g, " ")}`)
          }
        }
        let idx = 0
        content = content.replace(IMG_MARKER_REGEX, () => replacements[idx++])
      }
      // 移除模型输出被截断时残留的未闭合标记(避免原始标记入库)
      content = content.replace(/\[IMG:[^\]]*$/g, "")

      // A 流式恢复: 停止新快照并等在途快照完成,避免旧快照覆盖最终内容
      snapStopped = true
      await snapChain

      try {
        // 工具调用明细随消息入库:前端历史回显工具卡片;极端大结果(>32KB)放弃入库防膨胀
        let toolCallsMetadata: string | undefined
        if (collectedToolCalls.length > 0) {
          const json = JSON.stringify({ kind: 'tool_calls', version: 1, toolCalls: collectedToolCalls })
          if (json.length <= 32768) toolCallsMetadata = json
          else console.warn(`[chat] toolCalls metadata too large (${json.length}B), skipped`)
        }
        if (groupId) {
          // 对比模式: 重新生成时先删除本泳道同组旧消息,避免重复入库
          await prisma.message.deleteMany({
            where: { conversationId: convId!, groupId, role: "assistant", model: modelId },
          })
        }
        // Persist assistant response (with reasoning + token usage if available)
        // A 流式恢复: 单聊时更新草稿行为最终内容并置 streaming=false;
        // 草稿行已不存在(被清理/超时 finalize)时兜底重新插入,不丢消息。
        // 对比模式无草稿行(draftMessageId 恒为 null),保持原 create 行为。
        const persistData = {
          conversationId: convId!,
          role: "assistant" as const,
          content,
          reasoning: savedReasoning,
          model: modelId,
          // token 消耗统计(某些提供商可能不返回 usage)
          promptTokens: usage?.inputTokens,
          completionTokens: usage?.outputTokens,
          ...(toolCallsMetadata ? { metadata: toolCallsMetadata } : {}),
          ...(groupId ? { groupId } : {}),
          streaming: false,
        }
        if (draftMessageId) {
          try {
            await prisma.message.update({ where: { id: draftMessageId }, data: persistData })
          } catch {
            await prisma.message.create({ data: persistData })
          }
        } else {
          await prisma.message.create({ data: persistData })
        }
        // Update conversation: timestamp + auto-generate title on first message
        const titleUpdate = isNewConversation
          ? { title: userContent.slice(0, 30) || "新对话" }
          : {}
        await prisma.conversation.update({
          where: { id: convId! },
          data: { updatedAt: new Date(), ...titleUpdate },
        })
        // 新会话: 异步用 AI 生成更精准的标题(不阻塞 onFinish)
        if (isNewConversation && userContent) {
          const convIdCapture = convId!
          generateConversationTitle(userContent, baseModel).then(async (aiTitle) => {
            try {
              await prisma.conversation.update({
                where: { id: convIdCapture },
                data: { title: aiTitle },
              })
            } catch (err) {
              console.error('[chat] Failed to update AI-generated title:', err)
            }
          })
        }
        // Extract long-term memories in the background (never blocks the chat)
        if (memoryEnabled && content) {
          extractAndSaveMemories({
            userId,
            model: provider(realModelId),
            userText: userContent,
            assistantText: content,
          })
        }

        // 长上下文压缩: 当累计消息接近模型 contextWindow × 60% 时,
        // 异步把较早的消息压缩成摘要存到 ConversationSummary,
        // 下次请求会自动注入摘要代替被压缩的原文。
        // 不在对比模式下触发(多泳道并发写入易产生状态竞争)。
        if (!groupId && convId) {
          const totalMessages = await prisma.message.count({
            where: { conversationId: convId, archived: false, role: { in: ["user", "assistant"] } },
          })
          maybeCompressContext({
            conversationId: convId,
            modelId,
            model: provider(realModelId),
            userText: userContent,
            assistantText: content,
            contextWindow: modelDef.contextWindow,
            totalMessages,
          })
        }
      } catch (error) {
        // AI SDK's notify() silently swallows errors from onFinish callbacks,
        // so we must catch and log them ourselves to avoid silent data loss.
        console.error("[chat] Failed to persist assistant message:", error)
      }
    },
  })

  const responseHeaders: Record<string, string> = { "X-Conversation-Id": convId }
  if (isNewConversation) {
    const title = userContent.slice(0, 30) || "新对话"
    responseHeaders["X-Conversation-Title"] = encodeURIComponent(title)
  }

  // 手动构建 UI 消息流：过滤掉 [IMG:...] 标记再发给客户端
  const uiStream = toUIMessageStream({
    stream: result.stream,
    sendReasoning: true,
    sendStart: true,
    sendFinish: true,
    // 默认只给客户端 "An error occurred.",这里把上游真实错误转成可读消息
    onError: (error) => {
      console.error('[chat] Stream error:', error)
      if (error instanceof APICallError) {
        const status: number | undefined = error.statusCode ?? undefined
        if (status === 401) {
          return '服务商鉴权失败 (401),请检查该模型的 API Key 是否有效'
        }
        if (status === 403) {
          return '服务商拒绝请求 (403):额度不足或无权限，请检查账户余额'
        }
        if (status === 429) {
          return '请求过于频繁或超出限额 (429),请稍后重试'
        }
        if (typeof status === 'number' && status >= 500) {
          return `服务商服务器错误 (${status}),请稍后重试`
        }
        return typeof status === 'number'
          ? `服务商请求失败 (HTTP ${status}),请稍后重试`
          : '服务商请求失败，请稍后重试'
      }
      return '生成过程中出错，请重试'
    },
  })

  return createUIMessageStreamResponse({
    headers: responseHeaders,
    stream: uiStream.pipeThrough(createImgMarkerFilterStream()),
  })
  } catch (error) {
    console.error("[chat] Error processing chat request:", error)
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    )
  }
}
