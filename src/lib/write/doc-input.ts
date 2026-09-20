/**
 * 写作文档输入校验 —— /api/write/docs 与 /api/write/docs/[id] 共用。
 * 独立成 lib 是因为 Next.js 路由文件只允许导出 HTTP handler,
 * route.ts 之间不能互相 import 工具函数(构建期类型校验会报非法导出)。
 */

/** 正文长度上限(单章远超不到,防御异常超大请求) */
export const MAX_WRITE_CONTENT_CHARS = 300_000

/** 标题校验:trim 后 1-100 字,空/非法回落「未命名」 */
export function normalizeWriteTitle(raw: unknown): string {
  if (typeof raw !== "string") return "未命名"
  const t = raw.trim()
  if (!t) return "未命名"
  return t.slice(0, 100)
}

/** 正文校验:非法/超长返回 null,由调用方回 400;undefined 表示本次未传 */
export function normalizeWriteContent(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== "string") return null
  if (raw.length > MAX_WRITE_CONTENT_CHARS) return null
  return raw
}
