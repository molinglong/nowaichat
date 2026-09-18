/**
 * 转换编排:加载 → 逐页提取/分块/质检 → 组装 HTML。
 * UI 层只调 convertPdf 一个入口。
 */
import type { ConvertResult, PageResult } from '../types'
import { GARBLED_WARN_RATIO, garbledRatio, isScannedPage } from './detect'
import { extractPageItems } from './extract'
import { buildHtml } from './html-builder'
import { buildLines, orderPageSegments, segmentPage } from './layout'
import { loadPdfDocument } from './pdf-loader'

export async function convertPdf(
  data: ArrayBuffer,
  fileName: string,
  onProgress?: (ratio: number) => void,
): Promise<ConvertResult> {
  const pdf = await loadPdfDocument(data)
  const pages: PageResult[] = []
  const warnings: string[] = []
  let docTitle = ''
  let mappedTotal = 0

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const { items, pageWidth, mappedChars } = await extractPageItems(page)
    mappedTotal += mappedChars
    const charCount = items.reduce((sum, i) => sum + i.str.replace(/\s/g, '').length, 0)

    if (isScannedPage(charCount)) {
      pages.push({ pageNumber: n, blocks: [], charCount, skipped: 'scanned' })
    } else {
      // 先拆段/分栏重排再分块,双栏+旁注版式才不会串行混排
      const ordered = orderPageSegments(buildLines(items), pageWidth)
      const blocks = segmentPage(ordered, pageWidth, { firstPage: n === 1 })
      const ratio = garbledRatio(ordered.map((l) => l.text).join(''))
      const pageWarnings =
        ratio > GARBLED_WARN_RATIO
          ? [`第 ${n} 页约 ${Math.round(ratio * 100)}% 字符无法映射到 Unicode,转换质量存疑`]
          : undefined
      pages.push({ pageNumber: n, blocks, charCount, warnings: pageWarnings })
      if (!docTitle) {
        const title = blocks.find((b) => b.type === 'title')
        if (title) docTitle = title.text
      }
    }

    page.cleanup()
    onProgress?.(n / pdf.numPages)
    // 每页让出一次主线程,长文档不卡 UI
    await new Promise((r) => setTimeout(r, 0))
  }

  const skippedCount = pages.filter((p) => p.skipped).length
  if (skippedCount > 0) warnings.push(`${skippedCount} 页为扫描/图片页,无法提取文本`)
  if (mappedTotal > 0) {
    warnings.push(`已按方正数学字体映射修正 ${mappedTotal} 个字符(槡→√、犪→a 等)`)
  }

  const title = docTitle || fileName.replace(/\.pdf$/i, '')
  return { title, pageCount: pdf.numPages, pages, warnings, html: buildHtml(pages, title, warnings) }
}
