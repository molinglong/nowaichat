import {
  decodeUpstreamError,
  type UpstreamErrorAction,
  type UpstreamErrorCode,
  type UpstreamErrorInfo,
} from '@/lib/error-catalog'

export interface ChatErrorInfo {
  message: string
  type: 'api_key' | 'rate_limit' | 'network' | 'general'
  /** 一句话短标题（toast 用） */
  title: string
  /** 完整中文说明：发生了什么 + 该做什么 */
  detail: string
  /** detail 的首句，toast 用（横幅已承载全文，弹窗不再重复长文） */
  summary: string
  action: UpstreamErrorAction | null
  /** 服务商原始英文（已脱敏），仅供折叠查看与复制 */
  raw: string
  code: UpstreamErrorCode
}

const TYPE_BY_CODE: Record<UpstreamErrorCode, ChatErrorInfo['type']> = {
  invalid_api_key: 'api_key',
  config_missing: 'api_key',
  insufficient_balance: 'general',
  rate_limit: 'rate_limit',
  model_not_found: 'general',
  context_length: 'general',
  content_policy: 'general',
  timeout: 'network',
  network: 'network',
  server_error: 'general',
  session_expired: 'general',
  unknown: 'general',
}

/**
 * 错误文案的唯一来源是 `@/lib/error-catalog`。
 * 这里只做旧接口（message/type）到新接口（detail/action/raw）的适配，
 * 任何分支都不再把上游英文原文直接当主文案上屏。
 */
export function getErrorMessage(error: Error): ChatErrorInfo {
  const info: UpstreamErrorInfo = decodeUpstreamError(error.message || '')
  return {
    message: info.detail,
    type: TYPE_BY_CODE[info.code],
    title: info.title,
    detail: info.detail,
    summary: info.detail.split(/[。；;]/)[0] || info.title,
    action: info.action,
    raw: info.raw,
    code: info.code,
  }
}
