/** token 数展示:万位以上用 K/M 缩写(与模型选择器的上下文窗口口径一致),其余千分位。公共额度两块 UI(个人卡/管理员视图)共用 */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${m >= 100 ? Math.round(m) : Math.round(m * 10) / 10}M`
  }
  if (n >= 10_000) return `${Math.round(n / 1000)}K`
  return n.toLocaleString('zh-CN')
}

/**
 * 面值输入解析:接受 "100K" / "2M" / "1.5k" / "500000" 等写法,返回 tokens 整数;
 * 非法写法(含 0/负数/未知后缀)返回 NaN,由调用方做范围校验与报错。与 fmtTokens 同族。
 */
export function parseKmTokens(raw: string): number {
  const m = raw
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase()
    .match(/^(\d+(?:\.\d+)?)([KM]?)$/)
  if (!m) return NaN
  const n = Number.parseFloat(m[1])
  if (!Number.isFinite(n) || n <= 0) return NaN
  return Math.round(n * (m[2] === 'K' ? 1e3 : m[2] === 'M' ? 1e6 : 1))
}
