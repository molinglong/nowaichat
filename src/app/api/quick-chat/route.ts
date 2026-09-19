import {
  streamText,
  wrapLanguageModel,
  extractReasoningMiddleware,
  stepCountIs,
} from "ai"
import { getUserId } from "@/lib/api-auth"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/crypto"
import {
  getEffectiveModels,
  getEffectiveModel,
  createProviderInstanceForEffectiveModel,
} from "@/lib/ai/registry"
import { buildCustomModelDefinition, resolveApiKey, createCustomLanguageModel } from "@/lib/ai/custom-model"
import { TODO_TOOL_NAME, TODO_TOOL_PROMPT } from "@/lib/ai/todo-tool"
import { createTodoTool } from "@/lib/ai/todo-tool.server"
import type { ModelDefinition } from "@/lib/ai/types"

/**
 * 快问快答端点 —— 供新标签页(bento)等外部静态页通过 API Token 调用。
 *
 * 与 /api/chat 的差异：无会话/消息持久化(历史由客户端本地保存,每轮携带
 * 最近上下文)；system 固定为简短模式；工具只挂 manage_todo(第 1 步已落地)。
 * 指令与问答不做预分类 —— AI 经工具总线自决：调工具=就地执行，纯文本=快答。
 *
 * 响应：SSE(text/event-stream)，轻量 JSON 行协议：
 *   data: {"type":"text","value":"..."}         增量文本
 *   data: {"type":"tool-call","toolName":".."}  工具开始(前端可显示处理中)
 *   data: {"type":"tool-result","toolName":"..","output":{...}} 工具结果
 *   data: {"type":"error","value":"..."}        错误(流终止)
 *   data: {"type":"done"}                       结束
 */

export const maxDuration = 60

interface QuickChatMessage {
  role?: unknown
  content?: unknown
}

interface QuickChatBody {
  messages?: QuickChatMessage[]
  model?: unknown
}

const MAX_MESSAGES = 16
const MAX_CONTENT_CHARS = 4000

const QUICK_CHAT_SYSTEM: string = [
  "你是嵌入浏览器新标签页的 AI 快答助手。",
  "- 回答简短：一般 3-5 行内直击要点；不用 markdown 标题，可用短列表和粗体",
  "- 用户提到记待办/提醒/安排(「提醒我」「帮我记着」「加个待办」)、完成/删除/查看待办时，调用 manage_todo 工具执行，成功后用一句话确认，不要复述整个列表",
  "- manage_todo 不可用时(临时隔离等)，如实说明，不要虚构已操作",
  "- 超出快答范围(长文写作/完整代码/深度研究)时一句话说明，建议到 aichatt 完整会话处理",
].join("\n")

/** 提取错误对象的可读信息(兼容 Error / APICallError / 未知形状) */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "object" && err !== null) {
    const anyErr = err as { message?: unknown; stringValue?: unknown }
    if (typeof anyErr.message === "string") return anyErr.message
  }
  return typeof err === "string" ? err : "模型调用失败"
}

export async function POST(req: Request) {
  const userId = await getUserId(req)
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as QuickChatBody

  // 消息校验:仅 user/assistant、纯文本、条数与单条长度受限(客户端本地历史注入)
  const rawMessages = Array.isArray(body.messages) ? body.messages : []
  const messages = rawMessages
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: (m.content as string).slice(0, MAX_CONTENT_CHARS),
    }))

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "最后一条消息必须是用户发言" }, { status: 400 })
  }

  // 模型解析:body.model 可选;默认按该用户模型列表顺序取第一个已配置 Key 的
  // (列表首位可能是未配置 provider 的内置模型,直接取首个会开箱报 No API key)
  let modelId = typeof body.model === "string" && body.model ? body.model : ""
  if (!modelId) {
    const models = await getEffectiveModels(userId)
    for (const m of models) {
      const hasKey =
        (await prisma.apiKey.findUnique({
          where: { userId_provider: { userId, provider: m.provider } },
          select: { id: true },
        })) != null ||
        (m.provider === "qianwen" && !!process.env.API_KEY_DASHSCOPE)
      if (hasKey) {
        modelId = m.id
        break
      }
    }
    if (!modelId) modelId = models[0]?.id || "gpt-4o" // 全无 Key:保留原行为,由下方分支给出明确报错
  }

  let modelDef: ModelDefinition
  let apiKey: string | undefined
  let provider: (modelId: string) => ReturnType<typeof createProviderInstanceForEffectiveModel>
  let realModelId = modelId

  if (modelId.startsWith("custom:")) {
    const cmId = modelId.slice(7)
    const cmRecord = await prisma.customModel.findFirst({ where: { id: cmId, userId } })
    if (!cmRecord) {
      return Response.json({ error: `Unknown custom model: ${modelId}` }, { status: 400 })
    }
    modelDef = buildCustomModelDefinition(cmRecord)
    realModelId = cmRecord.modelId
    apiKey = await resolveApiKey(userId, cmRecord)
    provider = () => createCustomLanguageModel(cmRecord, apiKey)
  } else {
    const builtinModelDef = await getEffectiveModel(userId, modelId)
    if (!builtinModelDef) {
      return Response.json({ error: `Unknown model: ${modelId}` }, { status: 400 })
    }
    modelDef = builtinModelDef

    const apiKeyRecord = await prisma.apiKey.findUnique({
      where: { userId_provider: { userId, provider: modelDef.provider } },
    })
    if (!apiKeyRecord && modelDef.provider === "qianwen") {
      // 与 /api/chat 同规则:千问回落到环境变量 Key(免配置免费额度)
      apiKey = process.env.API_KEY_DASHSCOPE
      if (!apiKey) {
        return Response.json(
          { error: "DashScope API key not configured in server environment variables" },
          { status: 400 }
        )
      }
    } else if (!apiKeyRecord) {
      return Response.json(
        { error: `No API key configured for ${modelDef.provider}` },
        { status: 400 }
      )
    } else {
      try {
        apiKey = decrypt(apiKeyRecord.encryptedKey)
      } catch (err) {
        console.error(`[quick-chat] Failed to decrypt API key for user ${userId}:`, err)
        return Response.json({ error: "Failed to decrypt API key" }, { status: 500 })
      }
    }
    // 千问环境变量/解密后的用户 Key 均已就绪,与 /api/chat 同规则:provider 变量持工厂,
    // 调用 provider(realModelId) 才得到语言模型(多包一层会拿到工厂对象导致 SDK 报错)
    provider = createProviderInstanceForEffectiveModel(modelDef, apiKey as string)
  }

  try {
    // 推理提取与 /api/chat 同规则:DeepSeek 原生 reasoning_content,其余套 <think> 中间件
    let model = provider(realModelId)
    const isDeepSeekNativeReasoning = modelDef.provider === "deepseek" && modelDef.supportsReasoning
    if ((modelDef.supportsReasoning || false) && !isDeepSeekNativeReasoning) {
      model = wrapLanguageModel({
        model,
        middleware: extractReasoningMiddleware({ tagName: "think" }),
      })
    }

    const todoTool = createTodoTool(userId)

    const result = streamText({
      model,
      system: QUICK_CHAT_SYSTEM,
      messages,
      tools: { [TODO_TOOL_NAME]: todoTool },
      stopWhen: stepCountIs(5),
    })

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        }
        try {
          for await (const chunk of result.fullStream) {
            const c = chunk as {
              type?: string
              text?: unknown
              toolName?: unknown
              output?: unknown
              error?: unknown
            }
            if (c.type === "text-delta" && typeof c.text === "string") {
              send({ type: "text", value: c.text })
            } else if (c.type === "tool-call" && typeof c.toolName === "string") {
              send({ type: "tool-call", toolName: c.toolName })
            } else if (c.type === "tool-result" && typeof c.toolName === "string") {
              send({ type: "tool-result", toolName: c.toolName, output: c.output })
            } else if (c.type === "error") {
              console.error("[quick-chat] stream error:", c.error)
              send({ type: "error", value: extractErrorMessage(c.error) })
              break
            }
          }
          send({ type: "done" })
        } catch (err) {
          console.error("[quick-chat] stream failure:", err)
          send({ type: "error", value: extractErrorMessage(err) })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    })
  } catch (err) {
    console.error("[quick-chat] failed:", err)
    return Response.json({ error: extractErrorMessage(err) }, { status: 500 })
  }
}
