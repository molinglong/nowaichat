import { tool } from "ai"
import { z } from "zod"
import { executeQianfanSearch, type QianfanSearchResult } from "./search-engines/qianfan"
import { executeTavilySearch, type TavilySearchResult } from "./search-engines/tavily"
import { type SearchEngineId } from "./search-engines"

/**
 * 统一搜索结果格式（各引擎的 execute 函数返回此类型）
 */
export type SearchResultItem = QianfanSearchResult | TavilySearchResult

/**
 * 结构化搜索结果项（工具 output 的一部分,前端 ToolCallCard 直接渲染）
 */
export interface FormattedSearchResult {
  title: string
  url?: string
  snippet?: string
}

/**
 * 创建联网搜索工具（AI SDK tool）
 *
 * execute 返回结构化对象:
 * - 模型侧阅读 note 指引 + results 明细作答;
 * - 前端 ToolCallCard 从 tool part 的 output 里直接取 results 渲染来源列表。
 *
 * @param engine  搜索引擎 ID
 * @param apiKey  对应引擎的 API Key（解密后原文）
 * @returns AI SDK tool 对象
 */
export function createWebSearchTool(engine: SearchEngineId, apiKey: string) {
  const description =
    engine === "tavily"
      ? `联网搜索工具。当需要获取实时信息、最新新闻、当前事件、或用户明确要求搜索时使用。
输入中文或英文搜索关键词，工具会返回 Tavily 搜索结果（标题、链接、摘要）。
搜索结果会包含网页标题、URL 和内容摘要，请基于这些信息回答用户问题并注明来源。`
      : `联网搜索工具。当需要获取实时信息、最新新闻、当前事件、或用户明确要求搜索时使用。
输入中文或英文搜索关键词，工具会返回百度搜索结果（标题、链接、摘要）。
搜索结果会包含网页标题、URL 和内容摘要，请基于这些信息回答用户问题并注明来源。`

  return tool({
    description,
    inputSchema: z.object({
      query: z
        .string()
        .describe("搜索关键词，使用用户提问的语言，尽量简洁准确"),
    }),
    execute: async ({ query }) => {
      try {
        const results: SearchResultItem[] =
          engine === "tavily"
            ? await executeTavilySearch(query, apiKey, 5)
            : await executeQianfanSearch(query, apiKey, 5)
        return {
          query,
          engine,
          results: results.map(
            (r): FormattedSearchResult => ({
              title: r.title,
              ...(r.url ? { url: r.url } : {}),
              ...(r.snippet ? { snippet: r.snippet.slice(0, 300) } : {}),
            })
          ),
          note:
            results.length === 0
              ? `搜索「${query}」未找到相关结果。请基于你已有的知识回答，并如实告知用户搜索结果为空。`
              : "请基于以上搜索结果回答用户的问题，并在回答中自然引用来源。如果搜索结果不充分或信息已过时，请如实告知用户。",
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "未知搜索错误"
        console.error(`[${engine}-search]`, message)
        return {
          query,
          engine,
          results: [] as FormattedSearchResult[],
          error: message,
          note: `联网搜索失败: ${message}。请基于你已有的知识回答用户问题，并告知用户搜索暂时不可用。`,
        }
      }
    },
  })
}
