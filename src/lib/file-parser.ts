/**
 * 文件中转站的解析层:把上传文件提取为纯文本。
 * PDF 用 unpdf(pdfjs 的 serverless 构建,纯 JS,无 native 依赖);
 * 纯文本按 utf-8 全文读取;图片不走解析(由视觉模型直接看图)。
 * 仅可在服务端使用。
 */
import { extractText, getDocumentProxy } from "unpdf"

export interface ParseResult {
  text: string
  pageCount?: number
}

/** 非空白字符低于该阈值视为扫描件/图片型 PDF(纯扫描页提取结果≈0,只混有页码/水印) */
export const SCANNED_PDF_MIN_CHARS = 10

export function isPdfMimeType(mimeType: string): boolean {
  return mimeType === "application/pdf"
}

/** 解析 PDF,提取全文与页数;失败时抛出异常,由调用方记录 parseError */
export async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { totalPages, text } = await extractText(pdf, { mergePages: true })
  // unpdf 类型签名在 mergePages: true 时已把 text 收窄为 string
  return { text, pageCount: totalPages }
}

/** 纯文本文件按 utf-8 读取全文 */
export function parseTextFile(buffer: Buffer): ParseResult {
  return { text: buffer.toString("utf-8") }
}
