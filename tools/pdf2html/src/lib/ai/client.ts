/**
 * OpenAI 兼容视觉接口客户端:单页截图 → HTML 片段。
 * 只做最小封装;鉴权/跨域/限流的错误翻译成可操作文案。
 */
import type { AiSettings } from './settings'
import { AI_SYSTEM_PROMPT, buildPageInstruction } from './prompt'

/** 单页转换结果 */
export interface PageTurn {
  html: string
}

export class AiRequestError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AiRequestError'
    this.status = status
  }
}

/** 把 HTTP/网络错误翻译成用户可操作文案 */
export function describeAiError(err: unknown): string {
  if (err instanceof AiRequestError) return err.message
  if (err instanceof DOMException && err.name === 'AbortError') return '已取消'
  if (err instanceof TypeError) {
    return '请求失败:可能是接口地址不可访问,或中转站未开放跨域(CORS)'
  }
  return err instanceof Error ? err.message : 'AI 转换失败,请重试'
}

function endpointOf(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  return `${trimmed}/chat/completions`
}

function chatUrlOf(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  return trimmed.endsWith('/chat/completions') ? trimmed : endpointOf(baseUrl)
}

interface ChatChoiceMessage {
  content?: string | null
}

interface ChatCompletionResponse {
  choices?: { message?: ChatChoiceMessage }[]
}

/**
 * 转写单页。onRetry 用于进度展示;内部重试 2 次(429/5xx/网络错误),
 * 4xx 语义错误不重试直接抛出。
 */
export async function transcribePage(
  settings: AiSettings,
  pageDataUrl: string,
  pageNo: number,
  prevTail: string,
  signal?: AbortSignal,
  onRetry?: (attempt: number, waitMs: number) => void,
): Promise<PageTurn> {
  const body = {
    model: settings.model.trim(),
    temperature: 0.1,
    max_tokens: 8192,
    messages: [
      { role: 'system' as const, content: AI_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: buildPageInstruction(pageNo, prevTail) },
          { type: 'image_url' as const, image_url: { url: pageDataUrl, detail: 'high' as const } },
        ],
      },
    ],
  }

  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const waitMs = attempt === 1 ? 2000 : 5000
      onRetry?.(attempt, waitMs)
      await sleep(waitMs, signal)
    }
    try {
      const res = await fetch(chatUrlOf(settings.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey.trim()}`,
        },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const message = httpErrorMessage(res.status, text)
        // 限流与服务端错误可重试;鉴权/参数类错误立即失败
        if (res.status === 429 || res.status >= 500) {
          throw new AiRequestError(message, res.status)
        }
        throw new FatalAiError(message, res.status)
      }
      const json = (await res.json()) as ChatCompletionResponse
      const content = json.choices?.[0]?.message?.content
      if (!content || !content.trim()) {
        throw new AiRequestError('模型返回了空内容', res.status)
      }
      return { html: content }
    } catch (err) {
      if (err instanceof FatalAiError) throw err
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new AiRequestError('请求多次失败')
}

export class FatalAiError extends AiRequestError {}

function httpErrorMessage(status: number, bodyText: string): string {
  const brief = bodyText.slice(0, 200).replace(/\s+/g, ' ')
  switch (status) {
    case 401:
      return 'API Key 无效或未授权(401)'
    case 403:
      return '没有访问该模型的权限(403)'
    case 404:
      return '接口或模型不存在(404),请检查接口地址是否以 /v1 结尾、模型名是否正确'
    case 429:
      return `请求被限流(429),稍后自动重试 ${brief ? `:${brief}` : ''}`
    default:
      return `接口错误(${status}) ${brief}`
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}
