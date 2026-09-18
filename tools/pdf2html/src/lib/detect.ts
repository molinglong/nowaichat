/**
 * 质检层:扫描件判定 / 乱码比例 / pdfjs 错误归类。
 * 纯函数,无 pdfjs 依赖(错误归类只看 error.name)。
 */

/** 单页非空白字符低于该阈值视为扫描/图片页(与 aichatt file-parser 同口径) */
export const SCANNED_PAGE_MIN_CHARS = 10

/** 乱码字符占比高于该阈值时提示转换质量存疑(ToUnicode 缺失的 CID 字体) */
export const GARBLED_WARN_RATIO = 0.3

export function isScannedPage(charCount: number): boolean {
  return charCount < SCANNED_PAGE_MIN_CHARS
}

/**
 * 乱码判定:U+FFFD 替换符 / 私有区(PUA,内嵌字体未映射时常见) / U+FFF0 起的特殊区。
 * 空白字符不参与统计。
 */
export function garbledRatio(text: string): number {
  let bad = 0
  let total = 0
  for (const ch of text) {
    if (/\s/.test(ch)) continue
    total++
    const code = ch.codePointAt(0)!
    if (code === 0xfffd || (code >= 0xe000 && code <= 0xf8ff) || code >= 0xfff0) bad++
  }
  return total === 0 ? 0 : bad / total
}

/** 把 pdfjs 抛出的错误翻译成用户可读文案 */
export function describePdfError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? ''
  if (name === 'PasswordException') return 'PDF 已加密,暂不支持带密码的文件'
  if (name === 'InvalidPDFException') return '这不是有效的 PDF 文件'
  if (name === 'MissingPDFException') return '文件不存在或已被移动'
  return err instanceof Error ? err.message : '转换失败,请重试'
}
