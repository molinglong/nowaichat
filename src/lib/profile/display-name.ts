import { DISPLAY_NAME_MAX, sanitizeProfileText } from "./sanitize"

/**
 * 称呼回退链：nickname（用户在用户中心显式设置的称呼）→ name（注册用户名）→ 不出现称呼行。
 * 不回退邮箱前缀：邮箱是登录凭据，用户没把它当名字，AI 却拿它当称呼最刺眼。
 */
export function resolveDisplayName(
  nickname?: string | null,
  name?: string | null
): string {
  return (
    sanitizeProfileText(nickname, DISPLAY_NAME_MAX) ||
    sanitizeProfileText(name, DISPLAY_NAME_MAX)
  )
}
