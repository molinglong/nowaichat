import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { STYLE_PRESETS, presetFromOffset } from "@/lib/ai/style-presets"
import { REPLY_LENGTH_LEVELS, DEFAULT_REPLY_LENGTH } from "@/lib/ai/reply-length"
import { ephemeralScope } from "@/lib/ephemeral"

/**
 * PATCH /api/conversations/[id]/style
 *
 * 新版接受 { stylePreset } —— 9 个预设 id 之一(balanced/practical/dev/editor/mentor/scholar/concise/humorous/creative)。
 * 兼容 { styleOffset: 0-100 } —— 仅在 preset 缺失时作为兜底推导。
 * 另可携带 { replyLength } —— 回复长度档(minimal/short/standard/detailed);
 * 传 null 或 'standard' 均落库为 null(等价于「不限制」)。
 * 风格与长度为两条独立轴，可单独 PATCH 其一，也可一次改两项；至少传入其中一个。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "登录已失效，请重新登录后再试" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const rawPreset = body?.stylePreset
  const rawOffset = body?.styleOffset
  const rawLength = body?.replyLength

  const updateData: { stylePreset?: string; replyLength?: string | null } = {}

  // ── 风格轴
  if (typeof rawPreset === "string") {
    const valid = STYLE_PRESETS.find((p) => p.id === rawPreset)
    if (!valid) {
      return NextResponse.json(
        { error: `风格预设不存在，可选值：${STYLE_PRESETS.map((p) => p.id).join(", ")}` },
        { status: 400 }
      )
    }
    updateData.stylePreset = valid.id
  } else if (typeof rawOffset === "number" && Number.isFinite(rawOffset) && rawOffset >= 0 && rawOffset <= 100) {
    // 旧版 offset 仅用于在 preset 未显式给出时推导
    updateData.stylePreset = presetFromOffset(Math.round(rawOffset))
  }

  // ── 长度轴（独立于风格，未传时不动该字段）
  if (typeof rawLength === "string" || rawLength === null) {
    if (rawLength === null || rawLength === DEFAULT_REPLY_LENGTH) {
      updateData.replyLength = null
    } else {
      const valid = REPLY_LENGTH_LEVELS.find((l) => l.id === rawLength)
      if (!valid) {
        return NextResponse.json(
          { error: `回复长度档不存在，可选值：${REPLY_LENGTH_LEVELS.map((l) => l.id).join(", ")}` },
          { status: 400 }
        )
      }
      updateData.replyLength = valid.id
    }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: "请提供 stylePreset 或 styleOffset（0-100），或 replyLength（长度档）" },
      { status: 400 }
    )
  }

  const conversation = await prisma.conversation.updateMany({
    where: { id: params.id, userId: session.user.id, ...ephemeralScope(session) },
    data: updateData,
  })

  if (conversation.count === 0) {
    return NextResponse.json({ error: "内容不存在或已被删除" }, { status: 404 })
  }

  return NextResponse.json({
    success: true,
    stylePreset: updateData.stylePreset ?? null,
    replyLength: updateData.replyLength ?? null,
  })
}
