import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { encrypt, decrypt } from "@/lib/crypto"
import { SEARCH_ENGINES, type SearchEngineId } from "@/lib/ai/search-engines"

/**
 * GET /api/search/keys
 * 返回当前用户的联网搜索 Key（掩码显示）
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const keys = await prisma.searchApiKey.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      engine: true,
      encryptedKey: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  const result = keys.map((k: typeof keys[number]) => {
    let masked = "••••••••"
    try {
      const plain = decrypt(k.encryptedKey)
      masked = plain.slice(0, 4) + "••••" + plain.slice(-4)
    } catch {
      // keep default mask
    }
    return {
      id: k.id,
      engine: k.engine,
      maskedKey: masked,
      createdAt: k.createdAt,
      updatedAt: k.updatedAt,
    }
  })

  return NextResponse.json(result)
}

/**
 * POST /api/search/keys
 * Body: { engine: string, apiKey: string }
 * 创建或更新指定引擎的联网搜索 Key
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { engine, apiKey } = body

  if (!engine || typeof engine !== "string") {
    return NextResponse.json({ error: "engine is required" }, { status: 400 })
  }
  if (!apiKey || typeof apiKey !== "string") {
    return NextResponse.json({ error: "apiKey is required" }, { status: 400 })
  }
  if (!SEARCH_ENGINES[engine as SearchEngineId]) {
    return NextResponse.json(
      { error: `不支持的搜索引擎: ${engine}，目前支持：${Object.keys(SEARCH_ENGINES).join(", ")}` },
      { status: 400 }
    )
  }

  const encryptedKey = encrypt(apiKey)

  const existing = await prisma.searchApiKey.findFirst({
    where: { userId: session.user.id, engine },
  })

  let record
  if (existing) {
    record = await prisma.searchApiKey.update({
      where: { id: existing.id },
      data: { encryptedKey },
    })
  } else {
    record = await prisma.searchApiKey.create({
      data: {
        userId: session.user.id,
        engine,
        encryptedKey,
      },
    })
  }

  return NextResponse.json({ id: record.id, engine: record.engine })
}

/**
 * DELETE /api/search/keys
 * Body: { engine: string }
 * 删除指定引擎的联网搜索 Key
 */
export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { engine } = body

  if (!engine || typeof engine !== "string") {
    return NextResponse.json({ error: "engine is required" }, { status: 400 })
  }

  try {
    await prisma.searchApiKey.delete({
      where: {
        userId_engine: {
          userId: session.user.id,
          engine,
        },
      },
    })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Key not found" }, { status: 404 })
  }
}