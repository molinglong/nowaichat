import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

const VALID_CATEGORIES = new Set([
  "user_info",
  "preference",
  "habit",
  "project",
  "skill",
  "other",
  "manual",
  "general",
])

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [memories, user] = await Promise.all([
    prisma.memory.findMany({
      where: { userId: session.user.id },
      orderBy: [{ source: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { memoryEnabled: true },
    }),
  ])

  return NextResponse.json({
    memories,
    memoryEnabled: user?.memoryEnabled ?? true,
  })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))

  // ─── 批量导入模式（从 ChatGPT / Claude 等导入多条记忆）────────────
  // body.items: Array<{ category: string; content: string }>
  // body.sourceDetail?: string（如 "ChatGPT"）
  if (Array.isArray(body.items)) {
    const sourceDetail = (body.sourceDetail ?? "").toString().trim().slice(0, 50)
    const rawItems = body.items as Array<Record<string, unknown>>

    // 规范化 + 单条校验
    const normalized = rawItems
      .map((it) => {
        const category =
          typeof it.category === "string" && VALID_CATEGORIES.has(it.category)
            ? it.category
            : "other"
        const content =
          typeof it.content === "string" ? it.content.trim().slice(0, 200) : ""
        return { category, content }
      })
      .filter((it) => it.content.length >= 4)

    if (normalized.length === 0) {
      return NextResponse.json(
        { error: "没有可导入的记忆（每条至少 4 字、最多 200 字）" },
        { status: 400 }
      )
    }

    // 与已有记忆做内容去重（包含关系视为重复）
    const existing = await prisma.memory.findMany({
      where: { userId: session.user.id },
      select: { content: true },
    })
    const existingContents = existing.map((e) => e.content)
    const isDuplicate = (c: string) =>
      existingContents.some((e) => e.includes(c) || c.includes(e))

    const toCreate = normalized.filter((it) => !isDuplicate(it.content))

    if (toCreate.length === 0) {
      return NextResponse.json(
        { created: 0, skipped: normalized.length, total: normalized.length },
        { status: 200 }
      )
    }

    // 一次性写入
    const userId = session.user.id
    try {
      await prisma.memory.createMany({
        data: toCreate.map((it) => ({
          userId,
          category: it.category,
          content: it.content,
          source: "imported",
          sourceDetail: sourceDetail || null,
        })),
      })
    } catch (dbErr) {
      console.error("[memories.POST] createMany failed:", dbErr)
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr)
      return NextResponse.json(
        { error: `数据库写入失败: ${msg}`, detail: String(dbErr) },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        created: toCreate.length,
        skipped: normalized.length - toCreate.length,
        total: normalized.length,
      },
      { status: 201 }
    )
  }

  // ─── 单条手动添加模式（原行为，向后兼容）─────────────────────────
  const content = (body.content ?? "").toString().trim()
  if (!content) {
    return NextResponse.json({ error: "内容不能为空" }, { status: 400 })
  }
  if (content.length > 200) {
    return NextResponse.json({ error: "内容过长（最多 200 字）" }, { status: 400 })
  }

  // 与已有记忆去重
  const existing = await prisma.memory.findMany({
    where: { userId: session.user.id },
    select: { content: true },
  })
  if (existing.some((e) => e.content.includes(content) || content.includes(e.content))) {
    return NextResponse.json({ error: "已存在相同或相似的记忆" }, { status: 409 })
  }

  const memory = await prisma.memory.create({
    data: {
      userId: session.user.id,
      category: (body.category ?? "manual").toString() || "manual",
      content,
      source: "manual",
    },
  })

  return NextResponse.json(memory, { status: 201 })
}
