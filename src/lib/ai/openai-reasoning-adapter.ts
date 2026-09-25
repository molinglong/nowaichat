/**
 * OpenAI 兼容端点的思维链(reasoning)通用适配
 *
 * 背景:@ai-sdk/openai 的 chat 实现不解析 delta.reasoning_content,
 * 而大量 OpenAI 兼容服务(DashScope/SiliconFlow/DeepSeek 官方等)把思维链只放在
 * 该字段里 → 聊天界面"思考中..."后思维链被静默丢弃。
 *
 * 这里在 fetch 层补齐两件事:
 * 1. 响应侧(全端点):把 reasoning_content 包装成 <think>...</think> 文本塞回 content,
 *    交给 chat 路由的 extractReasoningMiddleware({ tagName: 'think' }) 统一抽取。
 *    不含 reasoning_content 的响应原样透传,零副作用。
 * 2. 请求侧(仅 DashScope 兼容端点):qwen3.8 系列默认开启思考,必须显式关闭,
 *    否则快答/write/tagging 等短任务也会白白思考。规则与内置 qianwen provider 一致:
 *    请求体带 reasoning_effort(非 none)时视为开启思考;否则强制 enable_thinking: false。
 */

function isDashScopeUrl(url: string): boolean {
  return /dashscope\.aliyuncs\.com/i.test(url)
}

function isDashScopeJsonBody(body: unknown): body is string {
  return typeof body === "string" && body.startsWith("{")
}

function withThinkingSwitch(init: RequestInit | undefined): RequestInit | undefined {
  if (!init || !isDashScopeJsonBody(init.body)) return init
  try {
    const parsed = JSON.parse(init.body) as Record<string, unknown>
    const effort = parsed.reasoning_effort
    delete parsed.reasoning_effort
    if (typeof effort === "string" && effort !== "none") {
      // 档位参数实测有效,保留即可开启思考
      parsed.reasoning_effort = effort
    } else {
      // qwen3.8 系列默认开启思考,必须显式关闭
      parsed.enable_thinking = false
    }
    return { ...init, body: JSON.stringify(parsed) }
  } catch {
    return init
  }
}

/** SSE 流式:delta.reasoning_content → <think>...</think> 文本 */
function wrapReasoningStream(res: Response): Response {
  if (!res.body) return res
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let sseBuf = ""
  let inThink = false

  const stream = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        sseBuf += decoder.decode(chunk, { stream: true })
        let idx: number
        while ((idx = sseBuf.indexOf("\n")) >= 0) {
          const line = sseBuf.slice(0, idx)
          sseBuf = sseBuf.slice(idx + 1)
          if (!line.startsWith("data:")) {
            controller.enqueue(encoder.encode(line + "\n"))
            continue
          }
          const payload = line.slice(5).trim()
          if (payload === "[DONE]") {
            controller.enqueue(encoder.encode(line + "\n"))
            continue
          }
          let parsed: Record<string, unknown>
          try {
            parsed = JSON.parse(payload)
          } catch {
            controller.enqueue(encoder.encode(line + "\n"))
            continue
          }
          const choice = (parsed as { choices?: Array<{ delta?: Record<string, unknown> }> }).choices?.[0]
          const delta = choice?.delta
          if (delta && typeof delta.reasoning_content === "string" && delta.reasoning_content) {
            let text = ""
            if (!inThink) {
              inThink = true
              text += "<think>"
            }
            text += delta.reasoning_content
            delta.content = text
            delete delta.reasoning_content
          } else if (delta && inThink && typeof delta.content === "string" && delta.content) {
            delta.content = "</think>" + delta.content
            inThink = false
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`))
        }
      },
      flush(controller) {
        // 思维链结束但未见正文时补闭合标签,避免 middleware 把尾巴吞进推理
        if (inThink) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "</think>" } }] })}\n\n`)
          )
        }
        if (sseBuf) controller.enqueue(encoder.encode(sseBuf))
      },
    })
  )
  return new Response(stream, { status: res.status, statusText: res.statusText, headers: res.headers })
}

/** 非流式 JSON:message.reasoning_content → content 前缀 <think>...</think> */
async function wrapReasoningJson(res: Response): Promise<Response> {
  const json = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
  } | null
  if (!json) return res
  const msg = json.choices?.[0]?.message
  if (msg && typeof msg.reasoning_content === "string" && msg.reasoning_content) {
    msg.content = `<think>${msg.reasoning_content}</think>` + (msg.content || "")
    delete msg.reasoning_content
  }
  return new Response(JSON.stringify(json), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}

/** 响应侧分发:按 content-type 选择 SSE / JSON 包装 */
export async function wrapOpenAIReasoningResponse(res: Response): Promise<Response> {
  const contentType = res.headers.get("content-type") || ""
  if (contentType.includes("text/event-stream")) return wrapReasoningStream(res)
  if (contentType.includes("application/json")) return wrapReasoningJson(res)
  return res
}

/**
 * 构造思维链感知的 fetch:
 * - DashScope 兼容端点 → 请求侧思考开关 + 响应侧 reasoning_content 包装
 * - 其他 OpenAI 兼容端点 → 仅响应侧包装(不改动请求体,避免未知参数被网关拒绝)
 */
export function createReasoningAwareFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    const isDashScope = isDashScopeUrl(url)
    const res = await fetch(input, isDashScope ? withThinkingSwitch(init) : init)
    if (!res.ok || !res.body) return res
    return wrapOpenAIReasoningResponse(res)
  }
}
