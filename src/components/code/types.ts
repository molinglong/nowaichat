/**
 * 代码编辑器共享类型 —— 前端与 API 返回结构对齐
 * (与 /api/code/docs 的 select 字段一一对应)。
 * 独立于写作画布(WriteDoc),专用于代码文档。
 */

/** 文档列表项(不含正文全文,字数看 charCount) */
export interface CodeDocSummary {
  id: string
  title: string
  language: string
  charCount: number
  createdAt: string
  updatedAt: string
}

/** 文档全文(编辑器加载用) */
export interface CodeDocFull extends CodeDocSummary {
  content: string
}
