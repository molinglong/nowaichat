import type { Memory } from "@/generated/prisma/client"

/** 记忆类别显示名 */
const CATEGORY_LABELS: Record<string, string> = {
  user_info: "身份信息",
  preference: "偏好",
  habit: "习惯",
  project: "项目",
  skill: "技能",
  other: "其他",
  general: "其他",
  manual: "手动添加",
}

export function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? "其他"
}

/**
 * 将记忆列表格式化为系统提示词
 */
export function buildMemorySystemPrompt(
  memories: Pick<Memory, "category" | "content">[]
): string {
  if (!memories.length) return ""
  const lines = memories.map(
    (m) => `- [${getCategoryLabel(m.category)}] ${m.content}`
  )
  return [
    "以下是关于用户的长期记忆（来自历史对话，可能不完整或已过时）：",
    ...lines,
    "回答时自然参考这些记忆，但不要主动提及记忆本身的存在。",
  ].join("\n")
}
