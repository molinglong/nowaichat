/**
 * 提取层:pdfjs page → TextItem 流。
 * 只做几何投影与旋转/竖排过滤,不做布局判断(那是 layout.ts 的事)。
 */
import type { PDFPageProxy } from 'pdfjs-dist'
import type { PageItems, TextItem } from '../types'
import { mapFounderMath } from './founder-map'

/** pdfjs TextItem 里本层关心的原始字段 */
interface RawTextItem {
  str: string
  dir: string
  width: number
  height: number
  transform: number[]
  fontName: string
}

export async function extractPageItems(page: PDFPageProxy): Promise<PageItems> {
  const content = await page.getTextContent()
  const items: TextItem[] = []
  let mappedChars = 0
  for (const raw of content.items) {
    if (!('str' in raw)) continue // TextMarkedContent 无文本,跳过
    const it = raw as unknown as RawTextItem
    if (!it.str || !it.str.trim()) continue
    // 方正数学字体伪汉字修正(槡→√、犪→a 等),1:1 替换不影响几何
    const mapped = mapFounderMath(it.str)
    mappedChars += mapped.hits
    // 竖排/旋转文本(dir 非 ltr)不参与横排重建
    if (it.dir && it.dir !== 'ltr') continue
    const [a, b] = it.transform
    // 旋转矩阵有明显剪切分量(>10%)同样过滤,水印/侧边章常是这种
    if (Math.abs(b) > Math.abs(a) * 0.1) continue
    items.push({
      str: mapped.text,
      x: it.transform[4],
      y: it.transform[5],
      width: it.width,
      fontSize: Math.abs(it.transform[3]) || it.height || 12,
      fontName: it.fontName ?? '',
    })
  }
  const view = page.view
  return {
    pageNumber: page.pageNumber,
    items,
    pageWidth: view ? view[2] - view[0] : 595,
    mappedChars,
  }
}
