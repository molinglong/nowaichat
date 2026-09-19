import { z } from 'zod'

/**
 * read_url —— 网页/PDF 全文阅读工具（isomorphic 常量模块）。
 *
 * 与 web_search 的分工：搜索只回标题+摘要；本工具把一个 URL 的全文读回来
 * （HTML 提正文、PDF 走 unpdf 提文字层），用于用户给出链接、需要基于全文
 * 出题/总结/翻译/引用原文的场景。
 *
 * 拆分铁律：本文件保持零服务端依赖（unpdf/fetch/Buffer 全在 url-reader.server.ts），
 * 客户端 ToolCallCard 只允许 import 本模块。
 */

export const URL_READER_TOOL_NAME = 'read_url'

export const URL_READER_TOOL_PROMPT = [
  '## 全文阅读能力 read_url',
  '你拥有 read_url 工具，可读取一个网页或在线 PDF 的全文。当出现以下场景时**主动调用**：',
  '- 用户消息里给出链接（"帮我看看这篇文章""读一下这个网页"）',
  '- 需要某篇文章/文档的完整原文来出题、总结、翻译、逐句讲解或引用原文',
  '- web_search 的摘要不够用，需要正文细节佐证',
  '一次只读一个 URL；读取失败时如实告知用户，绝对不要编造链接内容。',
].join('\n')

export const URL_READER_DISABLED_PROMPT = [
  '## 全文阅读能力（当前不可用）',
  'read_url 工具当前未启用。若用户给出链接，请告知用户：开启输入框的联网开关后重试，',
  '或直接把正文粘贴进来。绝对不要编造链接内容。',
].join('\n')

/** zod 字段集合（isomorphic，服务端工厂用 z.object 包成 inputSchema） */
export const URL_READER_INPUT_SCHEMA = {
  url: z
    .string()
    .describe('要读取的完整 URL，以 http:// 或 https:// 开头'),
}

/** 工具 output 形状（服务端 execute 返回，前端卡片渲染） */
export interface UrlReaderOutput {
  url: string
  kind: 'pdf' | 'html' | 'text'
  title?: string
  content?: string
  truncated?: boolean
  error?: string
  note?: string
}
