/**
 * 文件中转站的解析层:把上传文件提取为纯文本/Markdown。
 * PDF 用 unpdf(pdfjs 的 serverless 构建,纯 JS,无 native 依赖);
 * Excel 用 SheetJS 转 Markdown 表格;Word 用 mammoth(HTML 中间层)转 Markdown;
 * HTML 剥离可执行/样式块后转 Markdown;纯文本按 utf-8 全文读取;图片不走解析(由视觉模型直接看图)。
 * 仅可在服务端使用。
 */
import { extractText, getDocumentProxy } from "unpdf"
// SheetJS npm 源停留在 0.18.5(官方修复版只发 cdn.sheetjs.com,但该源在本项目网络环境不可达)。
// 已知 CVE(GHSA-4r6h ReDoS / GHSA-v9w6 原型污染)影响面:本项目仅 read+sheet_to_json 只读,
// 不使用 write/公式解析,污染路径不可达;若未来网络可达请升级 cdn 源 0.20.x
import * as XLSX from "xlsx"
import mammoth from "mammoth"
import TurndownService from "turndown"

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

/** XLSX 每个 sheet 转 Markdown 表格的最大行数(含表头),超出截断(注入时另有 20000 字符兜底) */
const XLSX_MAX_ROWS_PER_SHEET = 500

/** 解析 Excel(xlsx/xls),每个 sheet 输出一段 Markdown 表格;无数据时抛异常,由调用方记录 parseError */
export function parseXlsx(buffer: Buffer): ParseResult {
  const wb = XLSX.read(buffer, { type: "buffer" })
  const sections: string[] = []
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    if (!sheet) continue
    // header:1 得二维数组;defval:"" 保证空单元格占位,否则行长度不齐导致 Markdown 表格错位
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
    })
    if (!rows.length) continue
    const truncated = rows.length > XLSX_MAX_ROWS_PER_SHEET
    const slice = truncated ? rows.slice(0, XLSX_MAX_ROWS_PER_SHEET) : rows
    // 单元格内的 | 与换行会破坏 Markdown 表格结构,统一转义/压平
    const cells = (row: unknown[]) =>
      row.map((c) => String(c ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " "))
    const lines: string[] = [`## Sheet: ${name}`]
    lines.push(`| ${cells(slice[0]).join(" | ")} |`)
    lines.push(`| ${slice[0].map(() => "---").join(" | ")} |`)
    for (const row of slice.slice(1)) {
      lines.push(`| ${cells(row).join(" | ")} |`)
    }
    if (truncated) {
      lines.push(`（该 sheet 共 ${rows.length} 行，仅展示前 ${XLSX_MAX_ROWS_PER_SHEET} 行）`)
    }
    sections.push(lines.join("\n"))
  }
  if (!sections.length) {
    throw new Error("工作簿中没有可读取的数据")
  }
  return { text: sections.join("\n\n") }
}

// turndown 实例线程内复用;script/style 等噪音标签交给 stripNoiseBlocks 统一处理
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" })
turndown.remove(["script", "style", "iframe", "noscript", "head"])

/** 剥离可执行/纯样式块与注释,防脚本内容混入解析结果 */
function stripNoiseBlocks(html: string): string {
  return html
    .replace(/<(script|style|iframe|noscript)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
}

function htmlToMarkdown(html: string): string {
  return turndown
    .turndown(stripNoiseBlocks(html))
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** 解析 Word(docx):mammoth 提取语义 HTML,再转 Markdown 保留标题/列表/加粗结构;不支持老版 .doc */
export async function parseDocx(buffer: Buffer): Promise<ParseResult> {
  const { value: html } = await mammoth.convertToHtml({ buffer })
  const md = htmlToMarkdown(html)
  if (!md) throw new Error("文档内容为空")
  return { text: md }
}

/** 解析 HTML 文件文本为 Markdown;原文件落盘时强制改写为 .txt(见 upload route) */
export function parseHtmlText(html: string): ParseResult {
  const md = htmlToMarkdown(html)
  if (!md) throw new Error("未能从 HTML 中提取到文本")
  return { text: md }
}
