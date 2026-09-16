/**
 * 附件统一类型定义。
 * 服务端(route/page)与客户端(组件)共用,请勿在此引入任何运行时依赖。
 */
export interface Attachment {
  url: string
  name: string
  type: string
  size: number
}
