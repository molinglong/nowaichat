import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { encrypt, decrypt } from "@/lib/crypto"

/**
 * 高德地图 Key(plan_trip 行程卡片)的用户级配置。
 * jsKey + 安全密钥经 /api/amap-config 下发浏览器渲染地图;
 * wsKey 仅服务端 POI 坐标校准。未保存时回落服务器环境变量。
 */

const maskOf = (plain: string) =>
  plain.length <= 8 ? "••••" : plain.slice(0, 4) + "••••" + plain.slice(-4)

/** GET /api/amap/keys —— 当前保存的配置(掩码)+ 服务器 env 兜底情况 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rec = await prisma.amapKey.findUnique({ where: { userId: session.user.id } })

  let config: {
    jsKeyMasked: string
    secMasked: string | null
    wsMasked: string | null
    updatedAt: Date
  } | null = null
  if (rec) {
    const maskEnc = (enc: string | null) => {
      if (!enc) return null
      try {
        return maskOf(decrypt(enc))
      } catch {
        return null
      }
    }
    config = {
      jsKeyMasked: maskOf(rec.jsKey),
      secMasked: maskEnc(rec.encryptedSec),
      wsMasked: maskEnc(rec.encryptedWs),
      updatedAt: rec.updatedAt,
    }
  }

  return NextResponse.json({
    config,
    env: {
      jsKey: !!process.env.AMAP_JS_KEY,
      sec: !!process.env.AMAP_JS_SEC,
      ws: !!process.env.AMAP_WS_KEY,
    },
  })
}

/**
 * POST /api/amap/keys
 * Body: { jsKey?, sec?, ws? }  字段语义:undefined=不动;空串=清除(回落 env);非空=保存
 * jsKey 不允许清空(想全回落 env 请 DELETE 整条配置)。
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    jsKey?: string
    sec?: string
    ws?: string
  }

  const existing = await prisma.amapKey.findUnique({ where: { userId: session.user.id } })

  if (!existing && (!body.jsKey || !body.jsKey.trim())) {
    return NextResponse.json({ error: "JS API Key 为必填项" }, { status: 400 })
  }
  if (body.jsKey !== undefined && typeof body.jsKey !== "string") {
    return NextResponse.json({ error: "参数错误" }, { status: 400 })
  }
  if (body.jsKey === "" && !existing) {
    return NextResponse.json({ error: "JS API Key 为必填项" }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  // jsKey:undefined 不动;非空更新;空串仅当想清除 → 拒绝(引导用 DELETE)
  if (body.jsKey !== undefined && body.jsKey.trim() !== "") {
    data.jsKey = body.jsKey.trim()
  }
  // sec/ws:非空加密存;空串清除(null)回落 env
  if (body.sec !== undefined) {
    const v = body.sec.trim()
    data.encryptedSec = v === "" ? null : encrypt(v)
  }
  if (body.ws !== undefined) {
    const v = body.ws.trim()
    data.encryptedWs = v === "" ? null : encrypt(v)
  }

  const record = existing
    ? await prisma.amapKey.update({ where: { userId: session.user.id }, data })
    : await prisma.amapKey.create({
        data: { userId: session.user.id, jsKey: body.jsKey!.trim(), ...data },
      })

  return NextResponse.json({
    id: record.id,
    jsKeyMasked: maskOf(record.jsKey),
    hasSec: !!record.encryptedSec,
    hasWs: !!record.encryptedWs,
  })
}

/** DELETE /api/amap/keys —— 删除整条配置(全部回落服务器 env) */
export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    await prisma.amapKey.delete({ where: { userId: session.user.id } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "未保存过配置" }, { status: 404 })
  }
}
