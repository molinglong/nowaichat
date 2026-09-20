/**
 * 写作画布共享类型 —— 前端与 API 返回结构对齐
 * (与 /api/write/docs 的 select 字段一一对应)。
 */

/** 文档列表项(不含正文全文,字数看 charCount) */
export interface WriteDocSummary {
  id: string
  title: string
  charCount: number
  createdAt: string
  updatedAt: string
}

/** 文档全文(编辑器加载用) */
export interface WriteDocFull extends WriteDocSummary {
  content: string
}
