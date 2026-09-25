import { NextResponse } from "next/server"
import { getUserId } from "@/lib/api-auth"
import { prisma } from "@/lib/db"
import { normalizeWriteContent, normalizeWriteTitle } from "@/lib/write/doc-input"
import { normalizeCodeLanguage } from "@/lib/code/doc-input"

/**
 * 代码文档单篇读写删 —— /api/code/docs/[id]。
 * 归属校验统一先 findFirst({id, userId}) 再操作,找不到/非本人一律 404(不泄露存在性)。
 */

type RouteContext = { params: { id: string } }

export async function GET(req: Request, { params }: RouteContext) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const doc = await prisma.codeDoc.findFirst({
    where: { id: params.id, userId },
  })
  if (!doc) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 })
  }

  return NextResponse.json(doc)
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const data: { title?: string; content?: string; language?: string; charCount?: number } = {}
  if (body.title !== undefined) {
    data.title = normalizeWriteTitle(body.title)
  }
  if (body.content !== undefined) {
    const c = normalizeWriteContent(body.content)
    if (c === null) {
      return NextResponse.json({ error: "正文为空或超出长度上限" }, { status: 400 })
    }
    data.content = c
    data.charCount = c.length
  }
  if (body.language !== undefined) {
    data.language = normalizeCodeLanguage(body.language)
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 })
  }

  const existing = await prisma.codeDoc.findFirst({
    where: { id: params.id, userId },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 })
  }

  try {
    const doc = await prisma.codeDoc.update({
      where: { id: params.id },
      data,
      select: {
        id: true,
        title: true,
        language: true,
        charCount: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return NextResponse.json(doc)
  } catch (err) {
    console.error("[code-docs.PATCH] failed:", err)
    return NextResponse.json({ error: "保存失败" }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: RouteContext) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const existing = await prisma.codeDoc.findFirst({
    where: { id: params.id, userId },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 })
  }

  await prisma.codeDoc.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
