import { prisma } from "@/lib/db"
import { resolveDisplayName } from "./display-name"
import { GENERAL_DOMAIN, normalizeGeneralFields, type GeneralFields } from "./general"

export interface GeneralProfileState {
  exists: boolean
  enabled: boolean
  fields: GeneralFields
  displayName: string
  lastConfirmedAt: Date | null
}

const EMPTY: GeneralProfileState = {
  exists: false,
  enabled: false,
  fields: {},
  displayName: "",
  lastConfirmedAt: null,
}

/** 档案行 + 称呼的唯一读取口（chat 注入与 /api/profiles 共用，避免两处判据漂移） */
export async function loadGeneralProfile(userId: string): Promise<GeneralProfileState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      nickname: true,
      name: true,
      domainProfiles: { where: { domain: GENERAL_DOMAIN }, take: 1 },
    },
  })
  if (!user) return EMPTY
  const row = user.domainProfiles[0]
  if (!row) return { ...EMPTY, displayName: resolveDisplayName(user.nickname, user.name) }
  return {
    exists: true,
    enabled: row.enabled,
    fields: normalizeGeneralFields(row.fields).fields,
    displayName: resolveDisplayName(user.nickname, user.name),
    lastConfirmedAt: row.lastConfirmedAt,
  }
}
