/**
 * 代码文档输入校验 —— /api/code/docs 与 /api/code/docs/[id] 共用。
 * 标题/正文校验复用写作模块的通用文本校验(normalizeWriteTitle/Content),
 * 这里只补代码特有的 language 校验。Next.js route.ts 之间不能互导工具函数,
 * 故独立成 lib(与 write/doc-input.ts 同构)。
 */

/** 允许的语言标识(Monaco language id 范围内的常用子集,与 CodeEditor 下拉对齐);
 *  导出原始数组供 write_code 工具的 zod enum 复用,语言清单只此一处维护 */
export const CODE_LANGUAGE_IDS = [
  "typescript",
  "javascript",
  "python",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "csharp",
  "html",
  "css",
  "json",
  "markdown",
  "bash",
  "shell",
  "sql",
  "yaml",
  "php",
  "ruby",
  "swift",
  "kotlin",
  "plaintext",
] as const

const ALLOWED_LANGUAGES: ReadonlySet<string> = new Set(CODE_LANGUAGE_IDS)

/** language 校验:非法/未传回落 "typescript" */
export function normalizeCodeLanguage(raw: unknown): string {
  if (typeof raw !== "string") return "typescript"
  const v = raw.trim().toLowerCase()
  if (!ALLOWED_LANGUAGES.has(v)) return "typescript"
  return v
}
