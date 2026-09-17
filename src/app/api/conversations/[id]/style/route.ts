import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { STYLE_PRESETS, presetFromOffset } from "@/lib/ai/style-presets"
import { ephemeralScope } from "@/lib/ephemeral"

/**
 * PATCH /api/conversations/[id]/style
 *
 * 新版接受 { stylePreset } —— 6 个预设 id 之一(balanced/practical/dev/editor/mentor/scholar)。
 * 兼容 { styleOffset: 0-100 } —— 仅在 preset 缺失时作为兜底推导。
 * 任意时刻至少要传入其中一个。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const rawPreset = body?.stylePreset
  const rawOffset = body?.styleOffset

  let nextPreset: string | null = null
  if (typeof rawPreset === "string") {
    const valid = STYLE_PRESETS.find((p) => p.id === rawPreset)
    if (!valid) {
      return NextResponse.json(
        { error: `Invalid stylePreset. Must be one of: ${STYLE_PRESETS.map((p) => p.id).join(", ")}` },
        { status: 400 }
      )
    }
    nextPreset = valid.id
  } else if (typeof rawOffset === "number" && Number.isFinite(rawOffset) && rawOffset >= 0 && rawOffset <= 100) {
    // 旧版 offset 仅用于在 preset 未显式给出时推导
    nextPreset = presetFromOffset(Math.round(rawOffset))
  } else {
    return NextResponse.json(
      { error: "Provide stylePreset (string) or styleOffset (0-100)." },
      { status: 400 }
    )
  }

  const conversation = await prisma.conversation.updateMany({
    where: { id: params.id, userId: session.user.id, ...ephemeralScope(session) },
    data: { stylePreset: nextPreset },
  })

  if (conversation.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ success: true, stylePreset: nextPreset })
}