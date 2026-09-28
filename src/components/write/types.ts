/**
 * 写作画布共享类型 —— 前端与 API 返回结构对齐
 * (与 /api/write/docs 的 select 字段一一对应)。
 */

/** 文档列表项(不含正文全文,字数看 charCount) */
export interface WriteDocSummary {
  id: string
  title: string
  charCount: number
  /** 归属作品 id(未归属 null);生成时按作品注入设定 */
  workId: string | null
  /** 归属作品标题(列表徽标展示,未归属 null) */
  workTitle?: string | null
  createdAt: string
  updatedAt: string
}

/** 文档全文(编辑器加载用) */
export interface WriteDocFull extends WriteDocSummary {
  content: string
}

/** 作品列表项(/api/write/works,含条目/文档计数) */
export interface WorkSummary {
  id: string
  title: string
  description: string
  /** 作品级设定注入总开关 */
  settingsEnabled: boolean
  settingCount: number
  docCount: number
  createdAt: string
  updatedAt: string
}

/** 作品设定条目(分类 + 标题 + 别名 + 正文) */
export interface WorkSettingItem {
  id: string
  category: string
  title: string
  aliases: string
  content: string
  enabled: boolean
  sort: number
  updatedAt: string
}
