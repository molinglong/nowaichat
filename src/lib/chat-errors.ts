export interface ChatErrorInfo {
  message: string
  type: 'api_key' | 'rate_limit' | 'network' | 'general'
}

export function getErrorMessage(error: Error): ChatErrorInfo {
  const msg = error.message || ''

  // API Key missing
  if (msg.includes('No API key') || msg.includes('API key') || msg.includes('api key')) {
    // Try to extract provider name
    const match = msg.match(/for\s+(\w+)/i)
    const provider = match?.[1] || ''
    return {
      message: provider
        ? `请先在设置中配置 ${provider} 的 API Key`
        : '请先在设置中配置对应提供商的 API Key',
      type: 'api_key',
    }
  }

  // Rate limit
  if (msg.includes('rate') || msg.includes('429') || msg.includes('too many') || msg.includes('Too many')) {
    return { message: '请求过于频繁，请稍后再试', type: 'rate_limit' }
  }

  // Network errors
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ECONNREFUSED')) {
    return { message: '网络连接失败，请检查网络后重试', type: 'network' }
  }

  // Fallback: show the real error from the provider so users can see the cause
  // (e.g. quota exhausted, invalid model, auth failure, etc.)
  const cleaned = msg.replace(/^AI_APICallError:\s*/i, '').trim()
  return { message: cleaned || '发生错误，请重试', type: 'general' }
}
