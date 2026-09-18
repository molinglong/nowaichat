/**
 * pdfjs 加载层:worker 配置 + 文档打开。
 * worker 用 ?url 静态资源引入,dev/build/preview 三态行为一致。
 */
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export async function loadPdfDocument(data: ArrayBuffer) {
  return pdfjsLib.getDocument({ data }).promise
}
