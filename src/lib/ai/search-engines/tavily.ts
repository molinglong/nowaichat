/**
 * Tavily 联网搜索 API。
 * 官方文档: https://docs.tavily.com/documentation/api-reference/endpoint/search
 * 接入方式: POST https://api.tavily.com/search, Auth: Bearer tvly-xxxxx
 */

export interface TavilySearchResult {
  title: string
  url: string
  snippet: string
}

interface TavilyRawResponse {
  results?: Array<{
    title: string
    url: string
    content: string
  }>
  detail?: string
}

/**
 * 调用 Tavily 搜索 API。
 * @param query  搜索关键词
 * @param apiKey Tavily API Key（Bearer Token，格式 tvly-xxx）
 * @param topN   返回结果数量（默认 5，最大 20）
 */
export async function executeTavilySearch(
  query: string,
  apiKey: string,
  topN: number = 5
): Promise<TavilySearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: Math.min(Math.max(topN, 0), 20),
      search_depth: "basic",
    }),
  })

  if (!response.ok) {
    const status = response.status
    if (status === 401 || status === 403) {
      throw new Error("Tavily API Key 无效或权限不足，请检查 Key 是否正确")
    }
    throw new Error(`Tavily 搜索请求失败 (HTTP ${status})`)
  }

  const data: TavilyRawResponse = await response.json()

  if (data.detail) {
    throw new Error(`Tavily API 错误: ${data.detail}`)
  }

  const results = data.results ?? []

  return results.map((r) => ({
    title: r.title || "无标题",
    url: r.url || "",
    snippet: r.content || "",
  }))
}
