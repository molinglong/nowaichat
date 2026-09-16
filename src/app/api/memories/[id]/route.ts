import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

interface Params {
  params: { id: string }
}

/**
 * PATCH /api/memories/[id]
 * 编辑单条记忆内容。与 POST 一致:非空、≤200 字、去重(排除自身)。
 */
export async function PATCH(req: Request, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const memory = await prisma.memory.findUnique({
    where: { id: params.id },
    select: { userId: true },
  })

  if (!memory || memory.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const content = (body.content ?? "").toString().trim()
  if (!content) {
    return NextResponse.json({ error: "内容不能为空" }, { status: 400 })
  }
  if (content.length > 200) {
    return NextResponse.json({ error: "内容过长（最多 200 字）" }, { status: 400 })
  }

  // 与已有记忆去重(包含关系视为重复,排除自身)
  const existing = await prisma.memory.findMany({
    where: { userId: session.user.id, id: { not: params.id } },
    select: { content: true },
  })
  if (existing.some((e) => e.content.includes(content) || content.includes(e.content))) {
    return NextResponse.json({ error: "已存在相同或相似的记忆" }, { status: 409 })
  }

  const updated = await prisma.memory.update({
    where: { id: params.id },
    data: { content },
  })
  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const memory = await prisma.memory.findUnique({
    where: { id: params.id },
    select: { userId: true },
  })

  if (!memory || memory.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await prisma.memory.delete({ where: { id: params.id } })
  return NextResponse.json({ success: true })
}
