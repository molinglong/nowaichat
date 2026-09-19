import { tool } from 'ai'
import { z } from 'zod'
import { extractText, getDocumentProxy } from 'unpdf'
import {
  URL_READER_TOOL_NAME,
  URL_READER_INPUT_SCHEMA,
  type UrlReaderOutput,
} from './url-reader'
import { assertSafeUrl } from '@/lib/ssrf'

/**
 * read_url 工具工厂 —— 服务端专用（勿客户端 import：含 unpdf / fetch / Buffer）。
 *
 * 执行管线：SSRF 校验 → fetch（15s 超时 / 10MB 上限 / 浏览器 UA）→ 按 Content-Type 分流：
 * - application/pdf（或 .pdf 后缀）：Buffer → unpdf 提取文字层（扫描件无文字层时明确报错）
 * - text/html：去 script/style 后抽正文纯文本
 * - 其他文本类型：直读
 * content 截断 2 万字符，防止单次工具结果挤爆上下文。
 */

const FETCH_TIMEOUT_MS = 15_000
const MAX_BYTES = 10 * 1024 * 1024
const MAX_CONTENT_CHARS = 20_000

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function truncateContent(text: string): { content: string; truncated: boolean } {
  if (text.length <= MAX_CONTENT_CHARS) return { content: text, truncated: false }
  return {
    content: `${text.slice(0, MAX_CONTENT_CHARS)}\n\n…(内容过长已截断，原文共 ${text.length} 字符)`,
    truncated: true,
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/** HTML → 正文纯文本：去脚本样式、块级标签转行、压缩空白 */
function htmlToText(html: string): { title?: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : undefined
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|figcaption)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  const text = decodeEntities(body)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { title: title || undefined, text }
}

function isHtmlResponse(contentType: string, raw: string): boolean {
  if (contentType.includes('html')) return true
  // 部分 CDN 不回 content-type，按内容嗅探兜底
  return !contentType && /^\s*<(!doctype|html)/i.test(raw)
}

export function createUrlReaderTool() {
  return tool({
    description:
      '读取一个网页或在线 PDF 的全文内容。当用户给出链接、或需要文章/文档的完整原文（总结、出题、翻译、引用原文）时使用。联网搜索只返回摘要，需要正文细节时用本工具。',
    inputSchema: z.object(URL_READER_INPUT_SCHEMA),
    execute: async ({ url }): Promise<UrlReaderOutput> => {
      const base: UrlReaderOutput = { url, kind: 'html' }

      const blocked = assertSafeUrl(url)
      if (blocked) {
        return { ...base, error: blocked, note: `无法读取该链接：${blocked}。请告知用户。` }
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            // 浏览器 UA：部分站点对空 UA/爬虫 UA 返回 403
            'User-Agent': BROWSER_UA,
            Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
          },
        })

        if (!res.ok) {
          return {
            ...base,
            error: `HTTP ${res.status}`,
            note: `读取失败（状态码 ${res.status}）。链接可能需要登录或已失效，请告知用户。`,
          }
        }

        const contentType = (res.headers.get('content-type') ?? '').toLowerCase()

        // ---- PDF 分支 ----
        const isPdf =
          contentType.includes('application/pdf') ||
          (!contentType && url.toLowerCase().split(/[?#]/)[0].endsWith('.pdf'))
        if (isPdf) {
          const buf = await res.arrayBuffer()
          if (buf.byteLength > MAX_BYTES) {
            return {
              ...base,
              kind: 'pdf',
              error: 'PDF 过大',
              note: '该 PDF 超过 10MB，无法读取。请告知用户。',
            }
          }
          const pdf = await getDocumentProxy(new Uint8Array(buf))
          const extracted = await extractText(pdf, { mergePages: true })
          const fullText = (
            Array.isArray(extracted.text) ? extracted.text.join('\n\n') : extracted.text
          ).trim()
          if (!fullText) {
            return {
              ...base,
              kind: 'pdf',
              error: '无文字层',
              note: `该 PDF 共 ${extracted.totalPages} 页，但没有可提取的文字层（扫描件/图片版）。请告知用户，可建议其截图后以图片附件发送。`,
            }
          }
          const { content, truncated } = truncateContent(fullText)
          return {
            ...base,
            kind: 'pdf',
            content,
            truncated,
            note: `已读取 PDF 全文（${extracted.totalPages} 页${truncated ? '，内容有截断' : ''}）。请基于以上内容回答；引用时尽量注明章节/页码。`,
          }
        }

        // ---- HTML / 纯文本分支 ----
        const raw = await res.text()
        if (raw.length > MAX_BYTES) {
          return {
            ...base,
            error: '内容过大',
            note: '该页面内容过大，无法读取。请告知用户。',
          }
        }

        if (isHtmlResponse(contentType, raw)) {
          const { title, text } = htmlToText(raw)
          if (!text || text.length < 30) {
            return {
              ...base,
              kind: 'html',
              ...(title ? { title } : {}),
              error: '无可读正文',
              note: '该页面没有可提取的正文（可能是纯脚本渲染的站点）。请告知用户。',
            }
          }
          const { content, truncated } = truncateContent(text)
          return {
            ...base,
            kind: 'html',
            ...(title ? { title } : {}),
            content,
            truncated,
            note: `已读取网页全文${title ? `《${title}》` : ''}${truncated ? '（内容有截断）' : ''}。请基于以上内容回答，并自然引用来源。`,
          }
        }

        const { content, truncated } = truncateContent(raw)
        return {
          ...base,
          kind: 'text',
          content,
          truncated,
          note: '已读取文本内容，请基于以上内容回答。',
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.name === 'AbortError'
              ? `读取超时（${FETCH_TIMEOUT_MS / 1000}s）`
              : err.message
            : '未知错误'
        console.error(`[${URL_READER_TOOL_NAME}]`, message, url)
        return {
          ...base,
          error: message,
          note: `读取失败：${message}。请基于已有知识回答，并告知用户该链接暂时读不了。`,
        }
      } finally {
        clearTimeout(timer)
      }
    },
  })
}
