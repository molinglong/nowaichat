/**
 * 页面渲染层:pdfjs page → JPEG dataURL,供视觉模型识读。
 * 在主线程 canvas 绘制,串行调用;scale 越大识别越准、token 越多。
 */
import type { PDFPageProxy } from 'pdfjs-dist'

export async function renderPageToDataUrl(
  page: PDFPageProxy,
  scale = 2,
  quality = 0.82,
): Promise<string> {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 canvas,无法进行 AI 转换')
  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas.toDataURL('image/jpeg', quality)
}
