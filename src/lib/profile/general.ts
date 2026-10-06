import { IDENTITIES, STAGE_LADDER } from "./academic"

/**
 * 通用档案字段表（domain='general'）。
 * 只收「有档位 / 有时效 / 有行为后果」的字段：姓名、籍贯、爱好这类事实留在记忆流，
 * 档案里存第二份只会产生可漂移的副本。
 */

export const GENERAL_DOMAIN = "general"

/** 注入段的硬上限：general 无条件进每个对话的 system prompt，比领域段（800）更严 */
export const PROFILE_SECTION_CAP = 200

/** 文本型字段（职业）的单值长度上限 */
export const PROFILE_VALUE_MAX = 16

export type GeneralFieldId = "identity" | "stage" | "subjectTrack" | "occupation" | "goal" | "depth"

export interface GeneralFieldDef {
  id: GeneralFieldId
  label: string
  /** 档位型字段：落库值必须在白名单内；文本型字段省略此项 */
  options?: readonly { value: string; label: string }[]
  max?: number
}

export const GENERAL_FIELDS: readonly GeneralFieldDef[] = [
  {
    id: "identity",
    label: "身份",
    options: IDENTITIES.map((i) => ({ value: i.id, label: i.label })),
  },
  {
    id: "stage",
    label: "学段",
    options: STAGE_LADDER.map((s) => ({ value: s, label: s })),
  },
  {
    id: "subjectTrack",
    label: "选科路线",
    options: [
      { value: "phys-chem-bio", label: "物化生" },
      { value: "phys-chem-geo", label: "物化地" },
      { value: "hist-pol-geo", label: "史政地" },
      { value: "not-split", label: "还没分科" },
    ],
  },
  { id: "occupation", label: "职业", max: PROFILE_VALUE_MAX },
  {
    id: "goal",
    label: "目标",
    options: [
      { value: "no-drag", label: "期末不拉分" },
      { value: "first-tier", label: "冲一本" },
      { value: "interest", label: "纯兴趣" },
    ],
  },
  {
    id: "depth",
    label: "讲解深度",
    options: [
      { value: "full-steps", label: "步骤全写" },
      { value: "medium", label: "适中（跳步注明）" },
      { value: "ideas-only", label: "只给思路" },
    ],
  },
] as const

export type GeneralFields = Partial<Record<GeneralFieldId, string>>

export function emptyGeneralFields(): GeneralFields {
  return {}
}

export function generalFieldDef(id: string): GeneralFieldDef | undefined {
  return GENERAL_FIELDS.find((f) => f.id === id)
}

/** 落库值 → 展示/注入用文案（不在白名单内也原样返回，避免历史值显示成空白） */
export function generalFieldLabel(id: GeneralFieldId, value: string): string {
  const def = generalFieldDef(id)
  return def?.options?.find((o) => o.value === value)?.label ?? value
}

/**
 * 白名单校验：档位值不在表内一律丢弃（宁可少一项，不把模型/用户随口写的词固化进档案）。
 * rejected 回给接口层做提示，不静默吞掉。
 */
export function normalizeGeneralFields(
  raw: unknown
): { fields: GeneralFields; rejected: string[] } {
  const fields: GeneralFields = {}
  const rejected: string[] = []
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { fields, rejected: GENERAL_FIELDS.map((f) => f.id) }
  }
  const input = raw as Record<string, unknown>
  for (const def of GENERAL_FIELDS) {
    const value = input[def.id]
    if (value === null || value === undefined || value === "") continue
    if (typeof value !== "string") {
      rejected.push(def.id)
      continue
    }
    const trimmed = value.trim()
    if (def.options) {
      if (def.options.some((o) => o.value === trimmed)) fields[def.id] = trimmed
      else rejected.push(def.id)
    } else if (trimmed.length <= (def.max ?? PROFILE_VALUE_MAX)) {
      fields[def.id] = trimmed
    } else {
      rejected.push(def.id)
    }
  }
  return { fields, rejected }
}
