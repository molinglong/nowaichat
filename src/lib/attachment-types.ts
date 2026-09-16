/**
 * 附件统一类型定义。
 * 服务端(route/page)与客户端(组件)共用,请勿在此引入任何运行时依赖。
 */
export interface Attachment {
  url: string
  name: string
  type: string
  size: number
  // 中转站解析状态(仅前端展示用;服务端注入一律按 url 查库,不信任客户端字段)
  parseStatus?: "done" | "failed" | "skipped"
  parseError?: string
  pageCount?: number
  charCount?: number
}
