import { NextRequest } from "next/server"
import {
  streamText,
  wrapLanguageModel,
  extractReasoningMiddleware,
  toUIMessageStream,
  createUIMessageStreamResponse,
  APICallError,
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
import { KNOWLEDGE_TOOL_NAME, KNOWLEDGE_SUBJECT_LABELS } from "@/lib/ai/knowledge-tool"
import { createKnowledgeTool, hasKnowledgeChunks } from "@/lib/ai/knowledge-tool-server"
import { CLARIFY_TOOL_NAME, CLARIFY_TOOL_PROMPT, createClarifyTool } from "@/lib/ai/clarify"
import {
  LOCAL_FILE_TOOL_NAME,
  LOCAL_FILE_TOOL_PROMPT,
  createLocalFileTool,
} from "@/lib/ai/local-file-tool"
import {
  CODE_EDIT_TOOL_NAME,
  CODE_EDIT_TOOL_PROMPT,
  createCodeEditTool,
} from "@/lib/ai/code-edit-tool"
import {
  SETTINGS_TOOL_NAME,
  SETTINGS_TOOL_PROMPT,
  SETTINGS_DISABLED_PROMPT,
  buildSettingsSnapshotSection,
  createSettingsTool,
} from "@/lib/ai/settings-tool"
import {
  PROVIDER_MODEL_TOOL_NAME,
  createProviderModelTool,
} from "@/lib/ai/provider-model-tool"
import { buildProviderModelSection } from "@/lib/ai/provider-model-tool.server"
import {
  MEMORY_TOOL_NAME,
  MEMORY_TOOL_PROMPT,
  MEMORY_DISABLED_PROMPT,
} from "@/lib/ai/memory-tool"
import { createMemoryTool } from "@/lib/ai/memory-tool.server"
import {
  TODO_TOOL_NAME,
  TODO_TOOL_PROMPT,
  TODO_DISABLED_PROMPT,
} from "@/lib/ai/todo-tool"
import { createTodoTool } from "@/lib/ai/todo-tool.server"
import {
  MASK_TOOL_NAME,
  MASK_TOOL_PROMPT,
  createMaskGeneratorTool,
} from "@/lib/ai/mask-tool"
import {
  WRITE_DOC_TOOL_NAME,
  WRITE_DOC_TOOL_PROMPT,
} from "@/lib/ai/write-doc-tool"
import { createWriteDocTool } from "@/lib/ai/write-doc-tool.server"
import {
  WRITE_CODE_TOOL_NAME,
  WRITE_CODE_TOOL_PROMPT,
} from "@/lib/ai/write-code-tool"
import { createWriteCodeTool } from "@/lib/ai/write-code-tool.server"
import {
  TRIP_TOOL_NAME,
  TRIP_TOOL_PROMPT,
} from "@/lib/ai/trip-tool"
import { createTripTool } from "@/lib/ai/trip-tool.server"
import {
  URL_READER_TOOL_NAME,
  URL_READER_TOOL_PROMPT,
  URL_READER_DISABLED_PROMPT,
} from "@/lib/ai/url-reader"
import { createUrlReaderTool } from "@/lib/ai/url-reader.server"
import { buildMcpPromptSection } from "@/lib/ai/mcp/mcp-constants"
import {
  loadMcpToolsForUser,
  closeMcpClients,
  type McpLoadResult,
} from "@/lib/ai/mcp/mcp-client.server"
import { loadCompressionState, maybeCompressContext } from "@/lib/context-compression"
import type { SearchEngineId } from "@/lib/ai/search-engines"
import type { Attachment } from "@/lib/attachment-types"
import { sanitizeUploadName, readUploadAsDataUrl, sweepOrphanUploadsThrottled } from "@/lib/uploads"
import { SCANNED_PDF_MIN_CHARS } from "@/lib/file-parser"
import type { ModelDefinition } from "@/lib/ai/types"
import { isEphemeralSession } from "@/lib/ephemeral"
import { monitor } from "@/lib/monitor"

export const maxDuration = 120 // seconds。深度思考耗时较长,Vercel Pro 允许到 300

interface ChatRequestBody {
  model: string
  messages: IncomingMessage[]
  conversationId?: string
  deepThink?: boolean
  groupId?: string
  attachments?: Attachment[]
  styleOffset?: number // 旧版 0-100, default 50 if not provided(向后兼容)
  stylePreset?: string // 新版 preset id(见 src/lib/ai/style-presets.ts 的 STYLE_PRESETS)
  maskId?: string // 面具 id(内置面具见 @/lib/ai/builtin-masks);不传时从会话读取
  webSearch?: boolean // 客户端本次请求是否开启联网搜索
  searchEngine?: SearchEngineId // 联网搜索引擎，默认 qianfan
  mcpEnabled?: boolean // 客户端是否注入 MCP 外部工具(默认 true,仅显式 false 时跳过加载)
  settingsSnapshot?: Partial<Record<string, string>> // 客户端设置快照（AI 设置控制，executor.buildSettingsSnapshot 上报）
  currentWriteDocId?: string // 写作画布面板当前打开的文档 id（注入提示词与 append 续写）
  localFilesEnabled?: boolean // 客户端(Tauri)本地文件能力:仅桌面端且用户开关开启时上报 true,服务端据此注入 local_file 工具
  codePanelOpen?: boolean // 客户端上报:代码编辑器面板是否打开,服务端据此注入 code_edit 工具
}

/** 客户端传入的消息（UIMessage 格式的结构化子集）*/
interface IncomingPart {
  type: string
  text?: string
  /** tool-* part 专有字段（state=input-available/output-available/output-error）*/
  toolCallId?: string
  state?: string
  input?: unknown
  output?: unknown
  errorText?: string
}

interface IncomingMessage {
  role: string
  content?: string | IncomingPart[]
  parts?: IncomingPart[]
  text?: string
  /** UIMessage 序列化自带的消息 id(历史消息=数据库 id,本轮新消息=本地临时 id) */
  id?: string
  /** 后端写入的结构化 UI 提示: { kind: 'branch_summary', ... } */
  metadata?: unknown
}

/**
 * Convert incoming UIMessage format (from @ai-sdk/react useChat) to ModelMessage format
 * that streamText expects. UIMessages use `parts` array; ModelMessages use `content`.
 *
 * 客户端工具(local_file)多步续跑: tool-* part 与 assistant 消息走结构化转换——
 * 保留 reasoning(DeepSeek thinking 模式强制要求回传 reasoning_content,缺失直接 400)
 * 发出 tool-call,工具结果以独立 tool 消息紧随其后。普通纯文本历史维持原拼接行为,零回归。
 */
function convertToModelMessages(messages: IncomingMessage[]): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant" && m.role !== "system") continue
    let modelMessage: ModelMessage | null = null
    let toolMessage: ModelMessage | null = null
    if (typeof m.content === "string" && m.content) {
      // If message already has string content, use it directly
      modelMessage = { role: m.role, content: m.content } as ModelMessage
    } else if (Array.isArray(m.content) && m.content.length > 0) {
      // content is already structured parts → pass through
      modelMessage = { role: m.role, content: m.content } as unknown as ModelMessage
    } else if (Array.isArray(m.parts)) {
      const hasToolPart = m.parts.some(
        (p: IncomingPart) => typeof p.type === "string" && p.type.startsWith("tool-")
      )
      if (m.role === "assistant" && hasToolPart) {
        const content: Array<Record<string, unknown>> = []
        const toolResults: Array<Record<string, unknown>> = []
        for (const p of m.parts) {
          if (p.type === "text" && p.text) {
            content.push({ type: "text", text: p.text })
          } else if (p.type === "reasoning" && p.text) {
            content.push({ type: "reasoning", text: p.text })
          } else if (p.type.startsWith("tool-")) {
            const toolName = p.type.slice(5)
            // 只转换已完结的调用(input-streaming 等中间态跳过,避免悬空 tool-call)
            if (p.toolCallId && (p.state === "output-available" || p.state === "output-error")) {
              content.push({
                type: "tool-call",
                toolCallId: p.toolCallId,
                toolName,
                input: p.input ?? {},
              })
              toolResults.push({
                type: "tool-result",
                toolCallId: p.toolCallId,
                toolName,
                // v5 协议:output 必须是带 type 标签的包裹(json/error-text/text/...),
                // 裸对象会被 streamText 的 zod 校验拒绝(AI_InvalidPromptError)
                output:
                  p.state === "output-error"
                    ? { type: "error-text", value: p.errorText ?? "工具执行失败" }
                    : { type: "json", value: p.output ?? { ok: true } },
              })
            }
          }
          // step-start 等其他 part 不进入模型消息
        }
        if (content.length > 0) {
          modelMessage = { role: "assistant", content } as unknown as ModelMessage
        }
        if (toolResults.length > 0) {
          toolMessage = { role: "tool", content: toolResults } as unknown as ModelMessage
        }
      } else {
        const textContent = m.parts
          .filter((p: IncomingPart) => p.type === "text")
          .map((p: IncomingPart) => p.text ?? "")
          .join("")
        if (textContent) modelMessage = { role: m.role, content: textContent } as ModelMessage
      }
    } else {
      const fallback = String(m.content ?? m.text ?? "")
      if (fallback) modelMessage = { role: m.role, content: fallback } as ModelMessage
    }
    // Preserve metadata so downstream code can identify special message kinds
    // (e.g. branch_summary system messages that must be moved into the `system` param).
    if (modelMessage && m.metadata) (modelMessage as { metadata?: unknown }).metadata = m.metadata
    if (modelMessage) out.push(modelMessage)
    if (toolMessage) out.push(toolMessage)
  }
  return out
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
    // 临时聊天模式(访客密码登录):对话打隔离标记进隔离区。
    // 记忆写入/设置类工具全部物理级关闭,长期记忆注入由用户开关控制。
    const isEphemeral = isEphemeralSession(session)

    // 提前声明:长上下文摘要注入分支及多个 system 提示都需要读取 systemParts,
    // 在函数顶部集中声明一次,避免下游块式作用域里的 TDZ / use-before-define。
    const systemParts: string[] = []

    const body: ChatRequestBody = await req.json()
    const { model: modelId, messages: rawMessages, conversationId, deepThink, groupId, webSearch, searchEngine, mcpEnabled } = body
    const attachments = Array.isArray(body.attachments) ? body.attachments : []
    const hasImageAttachments = attachments.some((a) => a.type.startsWith("image/"))

    console.log(`[chat] Processing request for user ${userId}, model: ${modelId}, messages: ${rawMessages?.length || 0}, deepThink: ${deepThink}, webSearch: ${webSearch}, mcpEnabled: ${mcpEnabled}`)

    // 新版 preset 优先:body 显式传 stylePreset 时用之,否则查 DB 的 preset;
    // preset 缺失/null 时回退到旧的 styleOffset(老会话);offset 也无则默认 balanced。
    const requestedStylePreset = STYLE_PRESETS.find((p) => p.id === body.stylePreset)?.id
    const requestedStyleOffset =
      typeof body.styleOffset === 'number' && Number.isFinite(body.styleOffset)
        ? Math.max(0, Math.min(100, Math.round(body.styleOffset)))
        : undefined

    // 解析面具:body 显式传 maskId 时用之,否则查 DB;未知 id 视为无面具。
    // user: 前缀为自定义面具(getMaskById 内部校验归属)
    // 写作画布面板当前打开的文档,前端随请求附带:注入上下文让 AI 可用 append 续写这篇
const currentWriteDocId = typeof body.currentWriteDocId === "string" ? body.currentWriteDocId : null
const requestedMask = await getMaskById(body.maskId ?? null, userId)
    const requestedMaskRef = requestedMask?.ref

    let conversationStylePreset: string | null = null
    let conversationStyleOffset = 50
    let conversationMaskId: string | null = null
    // 归属标记:conversationId 确实属于当前用户且区隔匹配(临时↔正式)才允许复用,读取其数据。
    // 否则一律按"无会话"处理并新建,杜绝向他人会话写入(跨用户越权与跨区写入)。
    let conversationOwned = false
    if (conversationId) {
      try {
        const conv = await prisma.conversation.findFirst({
          where: { id: conversationId, userId, isEphemeral },
          select: { styleOffset: true, stylePreset: true, maskId: true },
        })
        conversationOwned = !!conv
        conversationStylePreset = conv?.stylePreset ?? null
        conversationStyleOffset = conv?.styleOffset ?? 50
        conversationMaskId = conv?.maskId ?? null
      } catch (err) {
        console.error("[chat] Failed to fetch conversation:", err)
      }
    }

    // 解析最终生效的面具:body > DB conv;未知 id 视为无面具。
    const effectiveMask = await getMaskById(requestedMaskRef ?? conversationMaskId, userId)
    const effectiveMaskId = effectiveMask?.ref ?? null
    if (effectiveMask) {
      console.log(`[chat] Mask: ${effectiveMask.ref} (body: ${requestedMaskRef ?? '-'}, conv: ${conversationMaskId ?? '-'})`)
    }

    // 解析最终生效的 preset:body > DB preset > 面具默认风格 > 旧 offset 推导 > balanced
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
  // 自定义模型推理信息:是否勾选推理 + Base URL(决定 deepThink 时是否注入 reasoning_effort 档位)
  let cmSupportsReasoning = false
  let cmBaseURL = ""

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
    cmSupportsReasoning = cmRecord.supportsReasoning
    cmBaseURL = cmRecord.baseURL || ""
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
      // 用户添加的模型（带 custom: 前缀）使用 modelDef.provider 查找 provider
      provider = createProviderInstanceForEffectiveModel(modelDef, apiKey)
    } catch (err) {
      console.error(`[chat] Failed to create provider instance for ${modelId}:`, err)
      return new Response(
        JSON.stringify({ error: `Failed to initialize AI provider` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      )
    }
  }

  // 长上下文压缩(剔除): 该会话已有远期摘要时,把被摘要覆盖的早期原文从本次请求中
  // 摘除——只发"摘要 + 未覆盖的近期原文",压缩才真正省 token。
  // 消息 id:若 id 不在覆盖集合(本地临时消息),一律保留,宁可多发不可漏发。
  const compressionState =
    conversationId && conversationOwned
      ? await loadCompressionState(conversationId)
      : null
  const effectiveRawMessages = compressionState
    ? rawMessages.filter(
        (m) => typeof m.id !== "string" || !compressionState.coveredIds.has(m.id)
      )
    : rawMessages

  // Convert incoming messages to ModelMessage format for streamText
  const messages = convertToModelMessages(effectiveRawMessages)

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
              text: `【附件·${att.name}】\n${text}${
                truncated ? "\n（内容过长，已截断前 20000 字符）" : ""
              }`
            })
          } else if (rec?.parseStatus === "done") {
            // done 但提取不到有效文本(扫描件/图片型 PDF)。视觉模型也读不了(服务端不渲染 PDF 页为图),
            // 故不误导用户切模型,直接给出可行动建议
            contentParts.push({
              type: "text",
              text: `（用户上传的 PDF「${att.name}」是扫描件/图片型，未能提取到文本。请告诉用户：可以将 PDF 中的文字内容复制后直接发送给你；图片型扫描件暂无法自动识别。）`,
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

  // 长上下文压缩(注入): 上方已摘除被覆盖的早期原文,这里把摘要注入 system 段,
  // 模型无需原文也能接续早期上下文。仅本人会话才读取(信息泄露防护)。
  if (compressionState?.content) {
    const SUMMARY_HEADER =
      "## 早期对话摘要（系统自动压缩，可能不完整，不要引用其中未确认的具体数字/代码细节）"
    systemParts.unshift(`${SUMMARY_HEADER}\n${compressionState.content}`)
    console.log(
      `[chat] injected summary (${compressionState.content.length} chars, ` +
        `dropped ${rawMessages.length - effectiveRawMessages.length} covered msgs) for conv ${conversationId}`
    )
  }

  // Extract text from the last user message for persistence & memory relevance
  const lastRawUserMsg = [...rawMessages].reverse().find((m) => m.role === "user")
  const userContent = lastRawUserMsg ? extractTextContent(lastRawUserMsg) : ""

  // Load the user's long-term memories (if the feature is enabled)
  const memorySettings = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      memoryEnabled: true,
      clarifyEnabled: true,
      aiSettingsControl: true,
      localFilesEnabled: true,
      imageModel: true,
      imageSize: true,
      ephemeralMemoryInjection: true,
    },
  })
  const memoryEnabled = memorySettings?.memoryEnabled ?? true
  const clarifyEnabled = memorySettings?.clarifyEnabled ?? true
  // 本地文件能力:DB 总开关(默认关)。与客户端上报的 body.localFilesEnabled 双重校验:
  // 二者皆真且非临时非对比才注入 local_file 工具(见下方工具定义区)。
  const localFilesEnabledDb = memorySettings?.localFilesEnabled ?? false

  // 临时模式默认不注入长期记忆(防借号场景:"你还记得我什么"套出隐私),
  // 用户可在正常模式 设置→账号信息 中打开"临时模式允许读取我的记忆"
  const injectMemory =
    memoryEnabled &&
    (!isEphemeral || (memorySettings?.ephemeralMemoryInjection ?? false))

  let memorySystemPrompt = ""
  if (injectMemory) {
    const memories = await prisma.memory.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    })
    if (memories.length > 0) {
      const relevant = getRelevantMemories(memories, userContent || "")
      memorySystemPrompt = buildMemorySystemPrompt(relevant)
    }
  }

  // 澄清提问:告诉模型何时调用 ask_clarification 工具(工具本体随下方 tools 注入)。
  // 升级自旧版自助反问"纯文本反问",现在以结构化卡片呈现,用户点选回答。
  const clarifySystemPrompt = CLARIFY_TOOL_PROMPT

  // Deep thinking: for non-reasoning models, add a system prompt and extract thinking via middleware
  let model = provider(realModelId)
  const baseModel = model // 保留原始模型引用，用于标题生成等后台任务
  if (memorySystemPrompt) systemParts.push(memorySystemPrompt)
  if (clarifyEnabled) systemParts.push(clarifySystemPrompt)

  // AI 设置控制:总开关开启且非对比模式时,注入快照、规则与 update_settings 工具;
  // 关闭时物理级不注入工具(总开关判定在服务端,模型无法影响),改注入降级提示。
  // 对比模式(groupId)两条泳道各自请求,不注入避免重复消耗与多泳道重复执行。
  const aiControlEnabled = memorySettings?.aiSettingsControl ?? true
  if (aiControlEnabled && !isEphemeral && !groupId) {
    systemParts.push(
      buildSettingsSnapshotSection(body.settingsSnapshot, {
        memoryEnabled,
        clarifyEnabled,
        imageModel: memorySettings?.imageModel,
        imageSize: memorySettings?.imageSize,
      })
    )
    systemParts.push(SETTINGS_TOOL_PROMPT)
    // 服务商模型管理(添加/移除/隐藏模型):与设置控制同开关同三道闸门。
    // 只注入规则+快照,真实写入由前端确认卡片完成(见 ProviderModelCard)。
    systemParts.push(await buildProviderModelSection(userId))
  } else if (!groupId && !isEphemeral) {
    systemParts.push(SETTINGS_DISABLED_PROMPT)
  }

  // 显式记忆添加:记忆功能开启且非对比模式时注入 add_memory 工具+规则。
  // 关闭时物理级不注入,改注入降级提示,避免模型虚构"已保存"。
  // 与 onFinish 的自动记忆提取互补:自动靠模型判断"值得记",本工具响应显式指令。
  if (memoryEnabled && !isEphemeral && !groupId) {
    systemParts.push(MEMORY_TOOL_PROMPT)
  } else if (!groupId) {
    systemParts.push(MEMORY_DISABLED_PROMPT)
  }

  // 面具工坊:非对比模式全量注入,无用户开关;草稿需用户在卡片上确认才入库。
  // 模型仅在用户明确要求生成面具时调用(与 update_settings 的 mask 项互斥分发)。
  // 临时模式不注入(生成的面具会写入用户面具库,写入不受隔离)
  if (!isEphemeral && !groupId) {
    systemParts.push(MASK_TOOL_PROMPT)
  }

  // 写作文档:非临时非对比模式注入(正文写库,写入受临时隔离);mask 无用户开关,
  // 模型仅在用户要求成篇幅正文时调用,产出进 WriteDoc 表与 /write 互通。
  if (!isEphemeral && !groupId) {
    // 面板打开时附带当前文档(校验属主),AI 可用 append 动作续写这篇
    let currentDocHint = ""
    if (currentWriteDocId) {
      const curDoc = await prisma.writeDoc.findFirst({
        where: { id: currentWriteDocId, userId },
        select: { title: true },
      })
      if (curDoc) {
        currentDocHint = `\n- 用户当前在写作画布打开的文档「${curDoc.title}」(id=${currentWriteDocId})。用户说续写/接着写,往这篇补充/修改这篇时，这是对该文档的编辑请求，必须调用 write_document 的 action=append 传该 id，content 只写新增正文(与原文自然衔接，不要重复原文)，不要把正文直接回复在聊天里；创作全新内容仍用 create`
      }
    }
    systemParts.push(WRITE_DOC_TOOL_PROMPT + currentDocHint)
  }

  // 代码文档:与 write_document 对称(非临时非对比),模型产出代码/网页类产物时创建
  // CodeDoc 并在前端自动滑出代码编辑器面板——「写个主页 html」类请求的默认通道,
  // 不再误入写作画布;两条 prompt 紧邻注入,边界对照更清晰。
  if (!isEphemeral && !groupId) {
    systemParts.push(WRITE_CODE_TOOL_PROMPT)
  }

  // 行程规划:非对比模式注入(纯只读不落库,临时模式安全);模型仅在用户提出
  // 旅游/出行规划意图时调用(坐标经服务端高德 POI 校准后由前端渲染地图卡片)。
  if (!groupId) {
    systemParts.push(TRIP_TOOL_PROMPT)
  }

  // 待办管理:非临时非对比模式注入 manage_todo 工具+规则。
  // 临时模式不注入(待办属长期数据,防污染),注入降级提示防虚构。
  // 与 REST API(/api/todos,新标签页插件)共用 Todo 表,变更互通。
  if (!isEphemeral && !groupId) {
    systemParts.push(TODO_TOOL_PROMPT)
  } else if (!groupId) {
    systemParts.push(TODO_DISABLED_PROMPT)
  }

  // Style prompt - 按 preset 渲染(新版)
  systemParts.push(getStylePromptFromPreset(effectiveStylePreset))

  // Image generation — tell the model how to request images
  // 非视觉模型收到图片附件时移除生图能力提示,避免模型被"图片"字眼诱导误触发生成。
  if (!(hasImageAttachments && !modelDef.supportsVision)) {
    systemParts.push([
      '## 生图能力',
      '用户想要生成图片时，在图片应出现的位置输出[IMG:详细描述]（用用户语言描述主体、风格、构图、光线），每条回复最多 2 张。',
    ].join('\n'))
  }

  // 联网搜索能力(仅在用户配置了联网搜索 Key 且本次请求主动开启了 webSearch 时才挂上工具)
  // - webSearchEnabled: 客户端本次是否主动开启,默认 false,避免模型无脑触发搜索消耗额度。
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

  // 全文阅读工具(read_url):与联网搜索共用开关(同一“联网”意图),无需 Key。
  // 只读工具,临时模式安全(课本 knowledge 同理)。与 web_search 分工:
  // 搜索回摘要,本工具读链接全文(HTML 正文/PDF 文字层,unpdf 已有依赖)。
  // 关闭时物理不注入,改注入降级提示防虚构。
  const urlReaderTool = webSearchEnabled ? createUrlReaderTool() : null
  if (urlReaderTool) {
    systemParts.push(URL_READER_TOOL_PROMPT)
  } else if (!groupId) {
    systemParts.push(URL_READER_DISABLED_PROMPT)
  }

  // MCP 外部工具:非临时非对比模式加载用户启用的 server(配置即全局生效)。
  // 连接失败只记入 failures,随能力段注入降级提示,不阻塞主流程;
  // 连接在 onFinish 统一 close(临时模式/对比模式根本不加载)。
  let mcp: McpLoadResult | null = null
  if (!isEphemeral && !groupId && mcpEnabled !== false) {
    try {
      mcp = await loadMcpToolsForUser(userId)
      if (mcp.promptInfos.length > 0 || mcp.failures.length > 0) {
        systemParts.push(buildMcpPromptSection(mcp.promptInfos, mcp.failures))
      }
      if (Object.keys(mcp.tools).length > 0) {
        console.log(`[chat] MCP tools attached: ${Object.keys(mcp.tools).length} from ${mcp.clients.length} server(s)`)
      }
    } catch (err) {
      console.error('[chat] Failed to load MCP tools:', err)
    }
  }
  const mcpToolCount = mcp ? Object.keys(mcp.tools).length : 0

  // 澄清提问工具(无 execute:输出 tool call 后本轮即结束,等用户在前端卡片上回答)。
  // 对比模式不注入(多泳道各自触发澄清卡片会互相踩踏),v1 仅单聊启用。
  const clarifyTool = clarifyEnabled && !groupId ? createClarifyTool() : null
  const settingsTool = aiControlEnabled && !isEphemeral && !groupId ? createSettingsTool() : null
  const providerModelTool =
    aiControlEnabled && !isEphemeral && !groupId ? createProviderModelTool() : null
  const memoryTool = memoryEnabled && !isEphemeral && !groupId ? createMemoryTool(userId) : null
  const maskGeneratorTool = !isEphemeral && !groupId ? createMaskGeneratorTool() : null
  const todoTool = !isEphemeral && !groupId ? createTodoTool(userId) : null
  const writeDocTool = !isEphemeral && !groupId ? createWriteDocTool(userId) : null
  // 代码文档落库需要 conversationId,但新对话的 convId 在下方才解析:
  // 改为工厂惰性单例 —— 首次 execute 时 convId 已确定,拿当届值建工具。
  // 用 const 局部变量中转,不依赖 TS 对闭包内可变捕获变量的收窄
  let writeCodeToolInstance: ReturnType<typeof createWriteCodeTool> | null = null
  const writeCodeTool = !isEphemeral && !groupId
    ? () => {
        const existing = writeCodeToolInstance
        if (existing) return existing
        const created = createWriteCodeTool(userId, convId)
        writeCodeToolInstance = created
        return created
      }
    : null
  const tripTool = !groupId ? createTripTool(userId) : null

  // 本地文件工具(无 execute:文件操作在用户本地机器执行,远程服务器碰不到磁盘)。
  // 注入三重闸门:①客户端上报 localFilesEnabled(仅 Tauri+用户开关会为 true)
  // ②DB 开关 localFilesEnabledDb ③非临时非对比模式。tool call 输出后本轮即结束,
  // 前端 onToolCall 经 Tauri 在工作区沙箱内执行(删除需卡片确认),经 addToolOutput 回填续跑。
  const localFileTool =
    body.localFilesEnabled === true && localFilesEnabledDb && !isEphemeral && !groupId
      ? createLocalFileTool()
      : null
  if (localFileTool) {
    systemParts.push(LOCAL_FILE_TOOL_PROMPT)
    console.log(`[chat] local_file tool attached (desktop client, user ${userId})`)
  }

  // 代码编辑器工具(无 execute:操作的是 DB 里的 CodeDoc + 前端 Diff 审查,不碰磁盘)。
  // 注入条件:客户端上报 codePanelOpen(用户打开了代码面板)且非临时非对比模式。
  const codeEditTool =
    body.codePanelOpen === true && !isEphemeral && !groupId
      ? createCodeEditTool()
      : null
  if (codeEditTool) {
    systemParts.push(CODE_EDIT_TOOL_PROMPT)
    console.log(`[chat] code_edit tool attached (user ${userId})`)
  }

  // 课本知识库检索:半绑定(用户名下有知识切块才注入,物理级闸门,无课本则工具不存在);
  // 面具学科倾向(如数学大师→math)仅作为能力段默认过滤建议,不锁死。
  // 只读工具,临时模式/对比模式均可安全使用。
  let knowledgeTool: ReturnType<typeof createKnowledgeTool> | null = null
  let knowledgeSubjectHint = ""
  try {
    if (await hasKnowledgeChunks(userId)) {
      knowledgeTool = createKnowledgeTool(userId, effectiveMask?.subject)
      const prefSubject = effectiveMask?.subject
      const prefLabel = prefSubject ? (KNOWLEDGE_SUBJECT_LABELS[prefSubject] ?? prefSubject) : ""
      knowledgeSubjectHint = prefSubject
        ? `当前面具偏好${prefLabel}学科：检索时默认传 subject="${prefSubject}"；用户明确问的是其他学科时，不传 subject（改查全部）。`
        : "不确定学科时不传 subject，查全部。"
      console.log(`[chat] knowledge tool attached (mask subject: ${effectiveMask?.subject ?? "-"})`)
    }
  } catch (err) {
    console.error("[chat] Failed to check knowledge chunks:", err)
  }
  if (searchTool) {
    const engineDisplayName = engine === "tavily" ? "Tavily" : "百度千帆"
    systemParts.push([
      '## 联网搜索能力',
      `你拥有 web_search 工具(基于 ${engineDisplayName} 搜索 API)。当用户问题涉及以下场景时,**主动调用 web_search** 一次或多次获取实时信息再作答。`,
      '- 询问新闻、事件、近期发生的事("今天/最近/最新"+时间)',
      '- 需要事实性数据(股价、天气、比赛结果、排行榜、版本号)',
      '- 引用具体来源、查证知识、用户要求查一查',
      '- 你对某个事实没有把握、训练数据可能已过时',
      '普通闲聊、通用知识问答、代码翻译/数学等不需要联网。回答时请自然引用来源，不要编造链接。',
    ].join('\n'))
  }

  // 课本知识库能力段:与 web_search 能力段同理,触发清单写在这里(模型自主决策依据)
  if (knowledgeTool) {
    systemParts.push([
      '## 课本知识库检索能力',
      '你拥有 search_knowledge 工具(检索用户上传的课本/教材)。当用户问题涉及以下场景时，**主动调用 search_knowledge** 获取课本原文后再作答:',
      '- 解释课本上的概念、定义、公式、法则(如「什么是相反数」「乘法分配律怎么说」)',
      '- 用户明确要求翻书/查课本时，按教材回答。',
      '- 讲评习题时需要引用教材原文佐证。',
      '- 你对某知识点的标准表述没有把握,需要以教材为准',
      '- 给用户出题(练习/变式/测验)时输出试卷块协议(:::choice/:::question 题块+紧跟 :::answer 答案块,答案块以**答案：X**」开头,渲染时答案默认折叠,用户先做后看;出题前若知识库覆盖该学科,先检索相关章节的【例题】【练习】举一反三,题块首行写检索到的真实出处「参考教材 §x.x 例N·学科」;知识库没有该学科课本(如语文),出处改标课文篇目「参考篇目名·学科」,用你确知的教材篇目,不得编造章节号或篇名',
      `闲聊、翻译、写代码、通用常识不需要调用。${knowledgeSubjectHint}回答时优先引用课本原文并标注来源(书名+章节);课本原文与你的知识冲突时,以课本为准。`,
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
    // DeepSeek V4 native thinking returns reasoning_content via API (no middleware needed)
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
  // 传入的 conversationId 不属于当前用户时拒绝复用(不向他人会话写任何数据),
  // 改为新建会话承接本次请求;归属查询抛错时同样视为无归属(fail-closed)。
  if (conversationId && !conversationOwned) {
    console.warn(`[chat] Conversation ${conversationId} not owned by user ${userId}; creating a new conversation instead`)
  }
  if (!convId || !conversationOwned) {
    const conv = await prisma.conversation.create({
      data: {
        userId,
        isEphemeral,
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
      // 对比模式: N 个泳道并发执行,事务内查重防止同一条用户消息入库多次。
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
      // C 分支轻量标记: 编辑产生的新 user 消息带 editedFrom 指向被编辑消息,
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

  // 附件孤儿的兜底清理:用户消息已落库即引用生效,此处顺带清掉
  // "上传了但从未发送"的历史孤儿(1 小时节流,fire-and-forget 不阻塞流)。
  sweepOrphanUploadsThrottled()

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
      // 分支 API 写入的内容已包含 "## 来自上文的上下文摘要(系统自动生成)" 头
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
  // 末尾统一追加逃生舱暗语(MASK_ESCAPE_HATCH),内置与自定义面具都适用
  if (effectiveMask) {
    systemParts.unshift(`${effectiveMask.systemPrompt}\n\n${MASK_ESCAPE_HATCH}`)
    console.log(`[chat] Mask persona injected: ${effectiveMask.ref}`)
  }

  // systemParts 可能被上面 unshift 过,重新 join
  const finalSystem = systemParts.length > 0 ? systemParts.join('\n\n') : undefined

  // Mask few-shot:预设对话示例插在真实消息之前。
  // 拼装发生在上下文压缩之后,不会被压缩统一吞掉。
  const maskFewShotMessages: ModelMessage[] = (effectiveMask?.fewShot ?? []).map((turn) => ({
    role: turn.role,
    content: turn.content,
  }))

  // Stream the response
  const result = streamText({
    model,
    messages: maskFewShotMessages.length > 0 ? [...maskFewShotMessages, ...llmMessages] : llmMessages,
    ...(finalSystem ? { system: finalSystem } : {}),
    // DeepSeek V4.1 起“思考”由请求参数控制(默认 enabled):deepThink 开 → enabled,
    // 关 → disabled,保证日常快答不被强制思考。reasoning_content 仍走原生解析,
    // 不经过 <think> middleware(见上面的 isDeepSeekNativeReasoning 分支)。
    // 其他 provider 不读 deepseek 命名空间,该选项对它们无副作用。
    ...(modelDef.provider === "deepseek"
      ? {
          providerOptions: {
            deepseek: {
              thinking: { type: deepThink ? "enabled" : "disabled" },
              ...(deepThink ? { reasoningEffort: "high" } : {}),
            },
          },
        }
      : {}),
    // qianwen 思考联动:qwen3.8 系列默认开思考,由 provider 的自定义 fetch 把
    // reasoning_effort 翻译成 enable_thinking(见 providers/qianwen.ts)。
    // deepThink 关 → 不带参数(fetch 层强制 enable_thinking: false);
    // deepThink 开 → 传档位开启思考。
    ...(modelDef.provider === "qianwen" && modelDef.supportsReasoning && deepThink
      ? { providerOptions: { openai: { reasoningEffort: "medium" } } }
      : {}),
    // 自定义模型思考联动:DashScope 兼容端点的 fetch 层把 reasoning_effort
    // 翻译成 enable_thinking(见 openai-reasoning-adapter.ts);勾了推理的模型
    // 在其他端点也传档位(OpenAI 兼容网关普遍接受/忽略该参数)。
    // deepThink 关 → 不传,DashScope fetch 层强制关闭思考,快答不受影响。
    ...(modelDef.provider === "custom" &&
    deepThink &&
    (cmSupportsReasoning || /dashscope\.aliyuncs\.com/i.test(cmBaseURL))
      ? { providerOptions: { openai: { reasoningEffort: "medium" } } }
      : {}),
    ...((searchTool || urlReaderTool || clarifyTool || settingsTool || providerModelTool || memoryTool || maskGeneratorTool || knowledgeTool || todoTool || writeDocTool || writeCodeTool || tripTool || localFileTool || mcpToolCount > 0)
      ? {
          tools: {
            ...(searchTool ? { web_search: searchTool } : {}),
            ...(mcpToolCount > 0 && mcp ? mcp.tools : {}),
            ...(urlReaderTool ? { [URL_READER_TOOL_NAME]: urlReaderTool } : {}),
            ...(knowledgeTool ? { [KNOWLEDGE_TOOL_NAME]: knowledgeTool } : {}),
            ...(clarifyTool ? { [CLARIFY_TOOL_NAME]: clarifyTool } : {}),
            ...(settingsTool ? { [SETTINGS_TOOL_NAME]: settingsTool } : {}),
            ...(providerModelTool ? { [PROVIDER_MODEL_TOOL_NAME]: providerModelTool } : {}),
            ...(memoryTool ? { [MEMORY_TOOL_NAME]: memoryTool } : {}),
            ...(maskGeneratorTool ? { [MASK_TOOL_NAME]: maskGeneratorTool } : {}),
            ...(todoTool ? { [TODO_TOOL_NAME]: todoTool } : {}),
            ...(writeDocTool ? { [WRITE_DOC_TOOL_NAME]: writeDocTool } : {}),
            ...(writeCodeTool ? { [WRITE_CODE_TOOL_NAME]: writeCodeTool() } : {}),
            ...(tripTool ? { [TRIP_TOOL_NAME]: tripTool } : {}),
            ...(localFileTool ? { [LOCAL_FILE_TOOL_NAME]: localFileTool } : {}),
            ...(codeEditTool ? { [CODE_EDIT_TOOL_NAME]: codeEditTool } : {}),
          },
        }
      : {}),
    // 让模型能"思考 → 调工具 → 拿到结果 → 继续生成最终答案",
    // 默认 stepCountIs(1) 会在调完一次工具后立刻停下,无法完成多步链式调用。
    // local_file 无服务端 execute(文件操作在用户本地机器):本步一旦发出 local_file 调用
    // 立即停步,等前端(Tauri)执行回填后经 sendAutomaticallyWhen 续跑;否则多步循环会带着
    // "悬空 tool-call"继续步进——与 MCP 等有 execute 工具混跑时,模型拿不到文件结果就给出
    // 半截正文,前端回填后续跑判据又被正文挡住,流程死停(实测 hono 分析中途停)。
    stopWhen: ({ steps }) => {
      if (steps.length >= 5) return true
      const last = steps[steps.length - 1]
      return !!last?.content?.some(
        (p) =>
          (p as { type?: string; toolName?: string }).type === "tool-call" &&
          (p as { toolName?: string }).toolName === LOCAL_FILE_TOOL_NAME
      )
    },
    // A 流式恢复: 累积快照文本并节流(600ms)写库。
    // 注意: onChunk 返回 Promise 会暂停流处理,这里保持同步 + fire-and-forget。
    // AI SDK v7 的 text-delta / reasoning-delta 的文本字段为 `text`。
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
      // MCP 连接收尾:提前到最前,后续任何 early return 都不会泄漏连接。
      if (mcp && mcp.clients.length > 0) {
        await closeMcpClients(mcp.clients)
        mcp = null
      }
      // 诊断日志:记录流异常结果,便于排查偶发"模型没思考"问题
      if (finishReason === 'length' || finishReason === 'error') {
        console.warn(
          `[chat] ABNORMAL_FINISH: reason=${finishReason}, model=${modelId}, hasText=${!!text}, hasReasoning=${!!reasoningText}, textLen=${text?.length ?? 0}, reasoningLen=${reasoningText?.length ?? 0}`
        )
      }

      // 流出错且无任何内容时不落库,避免历史中出现空白助手消息。
      // A 流式恢复: 先等在途快照落地;草稿行已有快照内容则定格保留,
      // 完全为空则删除,不留空白消息或永远 streaming 的残留行。
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
        content = content + '\n\n（提示：输出已达 token 上限被截断，可考虑换模型或缩短上下文）'
      }

      // 诊断:深度思考模式下,若两者都为空,说明模型真的没输出思考。
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

      // 检出 [IMG:...] 标记并调用生图(自动根据用户选择的模型分发)
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
            // 归档到生图历史库(source=chat),失败不阻塞对话保存。
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

      // A 流式恢复: 停止新快照并等在途快照完成,避免旧快照覆盖最终内容。
      snapStopped = true
      await snapChain

      try {
        // 工具调用明细随消息入库(前端历史回显工具卡片);极端大结果(>32KB)放弃入库防膨胀
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
        // 新会话: 异步让 AI 生成更精准的标题(不阻塞 onFinish)
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
        // 临时模式永不提取:借号者的聊天不得污染长期记忆
        if (memoryEnabled && !isEphemeral && content) {
          extractAndSaveMemories({
            userId,
            model: provider(realModelId),
            userText: userContent,
            assistantText: content,
          })
        }

        // 长上下文压缩: 当累计消息接近模型 contextWindow × 60% 时,
        // 异步把较早的消息压缩成摘要存入 ConversationSummary,
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
    // 默认只给客户端 "An error occurred.",这里把上游真实错误转成可读消息。
    onError: (error) => {
      console.error('[chat] Stream error:', error)
      if (error instanceof APICallError) {
        const status: number | undefined = error.statusCode ?? undefined
        monitor("chat_upstream_error", { status: status ?? null })
        if (status === 401) {
          return '服务商鉴权失败(401),请检查该模型的 API Key 是否有效'
        }
        if (status === 403) {
          return '服务商拒绝请求(403)：额度不足或无权限，请检查账户余额'
        }
        if (status === 429) {
          return '请求过于频繁或超出限额(429)，请稍后重试'
        }
        if (typeof status === 'number' && status >= 500) {
          return `服务商服务器错误 (${status}),请稍后重试`
        }
        return typeof status === 'number'
          ? `服务商请求失败(HTTP ${status})，请稍后重试`
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
