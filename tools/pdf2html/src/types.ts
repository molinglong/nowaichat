/**
 * 全项目共享类型:转换内核(lib/)与 UI 层的公共契约,纯类型无依赖。
 */

/** pdfjs textContent item 的精简投影:只留布局还原必需的几何与样式字段 */
export interface TextItem {
  /** 文本内容(可能是一个词、一个字符或一串字符) */
  str: string
  /** 基线左端点 x(PDF 用户空间) */
  x: number
  /** 基线 y(PDF 用户空间,页内越大越靠上) */
  y: number
  /** 横向总宽(pt) */
  width: number
  /** 字号(pt) */
  fontSize: number
  /** 字体资源名(如 "ABCDEE+SourceHanSansCN-Bold",可据此判断加粗) */
  fontName: string
}

/** 单页提取产物:item 流 + 页面几何 */
export interface PageItems {
  pageNumber: number
  items: TextItem[]
  /** 页面宽度(pt),用于居中判断 */
  pageWidth: number
  /** 本页命中方正数学字体映射的字符数(槡→√ 等) */
  mappedChars: number
}

/** 重组后的一行文字及其几何 */
export interface TextLine {
  text: string
  /** 基线 y(PDF 用户空间,越大越靠上) */
  y: number
  /** 左端 x */
  x: number
  /** 右端 x(末 item 左端 + 宽度) */
  right: number
  /** 行内字号中位数 */
  fontSize: number
  /** 行内任一 item 字体名含 bold/heavy/black */
  bold: boolean
}

/** 页面块结构:布局还原的最小语义单元 */
export type Block =
  | { type: 'title'; text: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }

export interface PageResult {
  pageNumber: number
  blocks: Block[]
  /** 非空白字符数,扫描件判定依据 */
  charCount: number
  /** 该页被跳过的原因 */
  skipped?: 'scanned'
  /** 页级质量警告(乱码比例高等) */
  warnings?: string[]
}

/** 单文件转换最终产物 */
export interface ConvertResult {
  title: string
  pageCount: number
  pages: PageResult[]
  /** 全文档级警告汇总 */
  warnings: string[]
  /** 自包含单文件 HTML,可直接下载打开 */
  html: string
}

export type ConvertStatus = 'converting' | 'done' | 'error'

/** UI 层单文件任务 */
export interface ConvertJob {
  id: string
  fileName: string
  size: number
  status: ConvertStatus
  /** 0-1,converting 时有效 */
  progress: number
  result?: ConvertResult
  error?: string
}
