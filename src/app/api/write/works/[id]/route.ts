import { NextResponse } from "next/server"
import { getUserId } from "@/lib/api-auth"
import { prisma } from "@/lib/db"
import { normalizeWorkDescription, normalizeWorkTitle } from "@/lib/write/work-input"

/**
 * 写作作品单条改删 —— /api/write/works/[id]。
 * 归属校验统一先 findFirst({id, userId}),找不到/非本人一律 404(不泄露存在性)。
 * 删除语义:设定条目随作品级联删除;归属本文档置空(文档保留,避免误删连带毁稿)。
 */

type RouteContext = { params: { id: string } }

export async function PATCH(req: Request, { params }: RouteContext) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const data: { title?: string; description?: string; settingsEnabled?: boolean } = {}
  if (body.title !== undefined) data.title = normalizeWorkTitle(body.title)
  if (body.description !== undefined) data.description = normalizeWorkDescription(body.description)
  if (typeof body.settingsEnabled === "boolean") data.settingsEnabled = body.settingsEnabled

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 })
  }

  const existing = await prisma.work.findFirst({
    where: { id: params.id, userId },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 })
  }

  const work = await prisma.work.update({
    where: { id: params.id },
    data,
    select: {
      id: true,
      title: true,
      description: true,
      settingsEnabled: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  return NextResponse.json(work)
}

export async function DELETE(req: Request, { params }: RouteContext) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const existing = await prisma.work.findFirst({
    where: { id: params.id, userId },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 })
  }

  await prisma.work.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
