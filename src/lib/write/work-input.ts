/**
 * 作品与设定条目输入校验 —— /api/write/works 系列路由共用。
 * 与 doc-input.ts 同风格:独立成 lib 是因为 route.ts 之间不能互相 import 工具函数。
 */

import {
  isWorkSettingCategory,
  MAX_SETTING_CONTENT_CHARS,
  type WorkSettingCategory,
} from "./work-settings"

export const MAX_WORK_TITLE_CHARS = 100
export const MAX_WORK_DESC_CHARS = 500
export const MAX_SETTING_TITLE_CHARS = 100
export const MAX_SETTING_ALIASES_CHARS = 200

/** 作品名:trim 后回落「未命名作品」,截断 100 字 */
export function normalizeWorkTitle(raw: unknown): string {
  if (typeof raw !== "string") return "未命名作品"
  const t = raw.trim()
  if (!t) return "未命名作品"
  return t.slice(0, MAX_WORK_TITLE_CHARS)
}

/** 作品简介:trim 后截断 500 字(允许空) */
export function normalizeWorkDescription(raw: unknown): string {
  if (typeof raw !== "string") return ""
  return raw.trim().slice(0, MAX_WORK_DESC_CHARS)
}

/** 条目标题:trim 后回落「未命名设定」,截断 100 字 */
export function normalizeSettingTitle(raw: unknown): string {
  if (typeof raw !== "string") return "未命名设定"
  const t = raw.trim()
  if (!t) return "未命名设定"
  return t.slice(0, MAX_SETTING_TITLE_CHARS)
}

/** 别名:trim 后截断 200 字(允许空) */
export function normalizeAliases(raw: unknown): string {
  if (typeof raw !== "string") return ""
  return raw.trim().slice(0, MAX_SETTING_ALIASES_CHARS)
}

/** 条目正文:非字符串返回 null(调用方回 400 或忽略);超长截断到上限 */
export function normalizeSettingContent(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  return raw.slice(0, MAX_SETTING_CONTENT_CHARS)
}

/** 分类:白名单外一律回落 other */
export function normalizeCategory(raw: unknown): WorkSettingCategory {
  return isWorkSettingCategory(raw) ? raw : "other"
}
