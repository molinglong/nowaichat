/**
 * AI 编排:加载 → 逐页渲染成图 → 视觉模型转写 → 组装。
 * 与文本模式(./convert.ts)平行的第二条管线,UI 入口按 mode 分发。
 */
import type { AiFragment } from './ai/assemble'
import { assembleAiHtml, extractTitleFromFragments, sanitizeFragment } from './ai/assemble'
import { AiRequestError, FatalAiError, describeAiError, transcribePage } from './ai/client'
import { renderPageToDataUrl } from './ai/render-page'
import type { AiSettings } from './ai/settings'
import { parsePageRange } from './ai/settings'
import type { AiProgress, ConvertResult } from '../types'
import { loadPdfDocument } from './pdf-loader'

export interface AiConvertCallbacks {
  onProgress: (progress: AiProgress) => void
  signal?: AbortSignal
}

export async function convertPdfWithAi(
  data: ArrayBuffer,
  fileName: string,
  settings: AiSettings,
  { onProgress, signal }: AiConvertCallbacks,
): Promise<ConvertResult> {
  const pdf = await loadPdfDocument(data)

  const rangeText = settings.pageRange.trim()
  const range = parsePageRange(rangeText, pdf.numPages)
  if (rangeText && !range) {
    throw new Error(`页码范围 "${rangeText}" 无效或超出文档页数(共 ${pdf.numPages} 页)`)
  }
  const start = range ? range[0] : 1
  const end = range ? range[1] : pdf.numPages
  const totalPages = end - start + 1

  const warnings: string[] = []
  const fragments: AiFragment[] = []
  let prevTail = ''
  let donePages = 0

  for (let n = start; n <= end; n++) {
    onProgress({ totalPages, donePages, currentPage: n })
    const page = await pdf.getPage(n)
    const dataUrl = await renderPageToDataUrl(page, settings.imageScale)
    page.cleanup()

    try {
      const { html } = await transcribePage(settings, dataUrl, n, prevTail, signal, (attempt, waitMs) => {
        onProgress({
          totalPages,
          donePages,
          currentPage: n,
          status: `请求失败,${Math.round(waitMs / 1000)} 秒后重试(第 ${attempt} 次)`,
        })
      })
      const frag = sanitizeFragment(html)
      if (frag) {
        fragments.push({ page: n, html: frag })
        prevTail = frag
      } else {
        warnings.push(`第 ${n} 页模型返回空内容,已跳过`)
      }
    } catch (err) {
      // 鉴权/路径等语义错误每页都会失败,立即中止避免白烧 token
      if (err instanceof FatalAiError) throw new Error(describeAiError(err))
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      // 限流/服务端错误重试耗尽:跳过该页继续,结束前汇总
      if (err instanceof AiRequestError) {
        warnings.push(`第 ${n} 页转换失败已跳过:${describeAiError(err)}`)
      } else {
        throw err
      }
    }

    donePages++
    onProgress({ totalPages, donePages, currentPage: n })
    // 让出主线程,长任务不卡 UI
    await new Promise((r) => setTimeout(r, 0))
  }

  const title = extractTitleFromFragments(fragments) || fileName.replace(/\.pdf$/i, '')
  if (warnings.length > 0) {
    warnings.unshift(`共 ${totalPages} 页,成功 ${fragments.length} 页`)
  }
  return {
    title,
    pageCount: pdf.numPages,
    pages: [],
    warnings,
    html: assembleAiHtml(fragments, title, warnings),
  }
}
