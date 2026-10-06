/**
 * 档案文本净化：用户可控文本进 system prompt 就是注入面，三条防线
 * （长度上限 / 单行化去控制字符 / 段头声明事实数据非指令）里的前两条在这里。
 */

export const DISPLAY_NAME_MAX = 20

/** 压成一行并去掉控制字符，再截到 cap；非字符串一律当空值处理 */
export function sanitizeProfileText(value: unknown, cap: number): string {
  if (typeof value !== "string") return ""
  const oneLine = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return oneLine.slice(0, Math.max(0, cap))
}
