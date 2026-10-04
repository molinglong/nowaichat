/**
 * 上游/AI 服务商错误的单一翻译层：服务端与客户端共用。
 *
 * 传输协议：聊天链路客户端只能拿到 error.message 一个字符串，因此结构化信息
 * 用 envelope 编码进该字符串：`ERR|<code>|<status>|<中文说明>|<base64(原文)>`。
 * 老客户端或不带 envelope 的消息一律按纯文本降级处理。
 */

export type UpstreamErrorCode =
  | 'invalid_api_key'
  | 'config_missing'
  | 'insufficient_balance'
  | 'rate_limit'
  | 'model_not_found'
  | 'context_length'
  | 'content_policy'
  | 'timeout'
  | 'network'
  | 'server_error'
  | 'session_expired'
  | 'unknown'

export interface UpstreamErrorAction {
  label: string
  settingsSection?: string
  href?: string
}

export interface UpstreamErrorInfo {
  code: UpstreamErrorCode
  /** 短文案，用于 toast 标题行 */
  title: string
  /** 完整中文说明：发生了什么 + 该做什么 */
  detail: string
  action: UpstreamErrorAction | null
  /** 上游原始英文（已脱敏），仅供折叠查看与复制 */
  raw: string
  status?: number
}

const ENVELOPE_PREFIX = 'ERR|'

/** 目录：文案与行动指引的唯一来源 */
const CATALOG: Record<
  UpstreamErrorCode,
  { title: string; detail: string; action: UpstreamErrorAction | null }
> = {
  invalid_api_key: {
    title: 'API Key 无效',
    detail: '服务商拒绝了请求（鉴权失败），这个模型的 API Key 已过期、填错或被删除。重新填写后即可继续。',
    action: { label: '检查 API Key', settingsSection: 'providers' },
  },
  config_missing: {
    title: '还没有配置 API Key',
    detail: '这个模型所属的服务商还没有可用的 API Key。到设置里填一次就能用。',
    action: { label: '去设置里填写', settingsSection: 'providers' },
  },
  insufficient_balance: {
    title: '服务商额度不足',
    detail: '请求被拒绝：账户余额不足、欠费，或该 Key 没有调用这个模型的权限。充值或换一个模型即可。',
    action: { label: '检查 Key 与额度', settingsSection: 'providers' },
  },
  rate_limit: {
    title: '请求过于频繁',
    detail: '触发了服务商的限流（每分钟请求数或 token 数超限）。稍等十几秒再重试通常就好了。',
    action: null,
  },
  model_not_found: {
    title: '模型不存在',
    detail: '服务商不认识这个模型名：可能已下架、改名，或自定义模型里的模型 ID 填错了。换一个模型或核对模型 ID。',
    action: { label: '去设置里核对模型', settingsSection: 'providers' },
  },
  context_length: {
    title: '上下文太长',
    detail: '这次请求的内容超过了模型的上下文上限。缩短输入、开新对话，或在设置里开启长上下文压缩。',
    action: null,
  },
  content_policy: {
    title: '内容被安全策略拦截',
    detail: '服务商的内容安全策略判定这段输入或输出不合规，拒绝生成。换个说法或换个模型再试。',
    action: null,
  },
  timeout: {
    title: '服务商响应超时',
    detail: '等待上游响应超时了，通常是服务商繁忙。直接重试即可。',
    action: null,
  },
  network: {
    title: '网络连接失败',
    detail: '本机没能连上服务商：网络中断、代理设置或地址填错。检查网络后重试。',
    action: null,
  },
  server_error: {
    title: '服务商服务器出错',
    detail: '上游服务端自身报错（5xx），不是你的配置问题。稍后重试，持续失败就换一个模型。',
    action: null,
  },
  session_expired: {
    title: '登录已失效',
    detail: '本机的登录状态过期了，重新登录后即可继续。',
    action: { label: '重新登录', href: '/login' },
  },
  unknown: {
    title: '生成失败',
    detail: '没能识别这个错误的具体原因。展开「查看原始错误」可以看到服务商的原文。',
    action: null,
  },
}

/**
 * 匹配规则按「特异性从高到低」排列，先命中先返回。
 * 只用可确证的上游字面量，不臆造规则；判不出的走 unknown → AI 诊断兜底。
 */
const MATCHERS: Array<{ code: UpstreamErrorCode; test: (text: string, status?: number) => boolean }> = [
  {
    code: 'context_length',
    test: (t) =>
      t.includes('context_length_exceeded') ||
      t.includes('maximum context length') ||
      t.includes('range of input') ||
      t.includes('prompt is too long') ||
      t.includes('too many tokens'),
  },
  {
    code: 'content_policy',
    test: (t) =>
      t.includes('content_policy') ||
      t.includes('content_filter') ||
      t.includes('datainspectionfailed') ||
      t.includes('inappropriate') ||
      t.includes('违规'),
  },
  {
    code: 'insufficient_balance',
    test: (t) =>
      t.includes('insufficient') ||
      t.includes('arrears') ||
      t.includes('exhausted') ||
      t.includes('quota') ||
      t.includes('billing') ||
      t.includes('balance') ||
      t.includes('欠费') ||
      t.includes('余额'),
  },
  {
    code: 'invalid_api_key',
    test: (t, status) =>
      status === 401 ||
      t.includes('invalid_api_key') ||
      t.includes('incorrect api key') ||
      t.includes('invalid api key') ||
      t.includes('api key not valid') ||
      t.includes('authentication_error') ||
      t.includes('invalidauthentication') ||
      t.includes('unauthorized'),
  },
  {
    code: 'model_not_found',
    test: (t, status) =>
      t.includes('model_not_found') ||
      t.includes('does not exist') ||
      t.includes('unknown model') ||
      t.includes('invalid model') ||
      t.includes('model not found') ||
      (status === 404 && t.includes('model')),
  },
  {
    code: 'rate_limit',
    test: (t, status) =>
      status === 429 ||
      t.includes('rate limit') ||
      t.includes('rate_limit') ||
      t.includes('too many requests') ||
      t.includes('requests per minute') ||
      t.includes('tokens per minute') ||
      t.includes('限流'),
  },
  {
    code: 'timeout',
    test: (t) => t.includes('timeout') || t.includes('timed out') || t.includes('etimedout') || t.includes('deadline'),
  },
  {
    code: 'network',
    test: (t) =>
      t.includes('failed to fetch') ||
      t.includes('networkerror') ||
      t.includes('network request failed') ||
      t.includes('econnrefused') ||
      t.includes('econnreset') ||
      t.includes('fetch failed') ||
      t.includes('socket hang up') ||
      t.includes('enotfound') ||
      t.includes('代理'),
  },
]

/** 上游原文可能带 Key 片段，展示与落日志前一律脱敏 */
export function sanitizeErrorText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_\-]{4,}/g, 'sk-****')
    .replace(/(api[_-]?key["'\s:=]+)[^\s"',}]{6,}/gi, '$1****')
}

function stripEnvelopePrefix(text: string): string {
  return text.startsWith(ENVELOPE_PREFIX) ? '' : text
}

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function b64decode(text: string): string {
  const binary = atob(text)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function classifyMessage(message: string, status?: number): UpstreamErrorCode {
  const text = message.toLowerCase()
  // 本仓库自产的确切字面量：登录态失效（上游的鉴权失败通常带更长的描述文本）
  if (text.trim() === 'unauthorized') return 'session_expired'
  for (const matcher of MATCHERS) {
    if (matcher.test(text, status)) return matcher.code
  }
  if (typeof status === 'number' && status >= 500) return 'server_error'
  if (typeof status === 'number' && status >= 400) return 'unknown'
  return 'unknown'
}

/**
 * 服务端入口：把任意上游/内部错误翻译成结构化中文信息。
 * fromServer 用于前置校验这类"我们自己产生"的确定性错误，直接指定 code。
 */
export function classifyUpstreamError(
  error: unknown,
  options?: { code?: UpstreamErrorCode; status?: number; fallbackDetail?: string }
): UpstreamErrorInfo {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error ?? '')
  const raw = sanitizeErrorText(stripEnvelopePrefix(rawMessage)).trim()
  const status = options?.status ?? readStatus(error)

  const code = options?.code ?? classifyMessage(raw, status)
  const entry = CATALOG[code]
  const detail = options?.fallbackDetail
    ? `${entry.detail}（${options.fallbackDetail}）`
    : entry.detail

  return { code, title: entry.title, detail, action: entry.action, raw, status }
}

function readStatus(error: unknown): number | undefined {
  const candidate = error as { statusCode?: number; status?: number } | undefined
  const status = candidate?.statusCode ?? candidate?.status
  return typeof status === 'number' ? status : undefined
}

/** 编码成上屏字符串：结构化信息随 error.message 一起走到客户端 */
export function encodeUpstreamError(info: UpstreamErrorInfo): string {
  const detail = info.detail.replace(/\|/g, '/')
  const status = info.status ?? '-'
  const raw = info.raw ? b64encode(info.raw.replace(/\|/g, '/')) : '-'
  return `${ENVELOPE_PREFIX}${info.code}|${status}|${detail}|${raw}`
}

/** 客户端入口：先解 envelope，解不出再按关键词分类（兼容 SDK 自产错误与非本服务的响应） */
export function decodeUpstreamError(message: string): UpstreamErrorInfo {
  const text = message ?? ''
  if (!text.startsWith(ENVELOPE_PREFIX)) {
    const cleaned = sanitizeErrorText(text.replace(/^AI_APICallError:\s*/i, '').trim())
    const code = classifyMessage(cleaned)
    const entry = CATALOG[code]
    return { code, title: entry.title, detail: entry.detail, action: entry.action, raw: cleaned }
  }

  const [, code, status, detail, raw] = text.split('|')
  const known = code as UpstreamErrorCode
  const entry = CATALOG[known] ?? CATALOG.unknown
  let decodedRaw = ''
  if (raw && raw !== '-') {
    try {
      decodedRaw = b64decode(raw)
    } catch {
      decodedRaw = raw
    }
  }
  const parsedStatus = status && status !== '-' ? Number(status) : undefined
  return {
    code: entry === CATALOG.unknown ? classifyMessage(decodedRaw, parsedStatus) : known,
    title: entry.title,
    detail: detail || entry.detail,
    action: entry.action,
    raw: decodedRaw,
    status: Number.isFinite(parsedStatus) ? parsedStatus : undefined,
  }
}

export function errorCatalogEntry(code: UpstreamErrorCode) {
  return CATALOG[code]
}
