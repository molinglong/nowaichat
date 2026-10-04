import { NextResponse } from "next/server"
import { getUserId } from "@/lib/api-auth"
import { prisma } from "@/lib/db"
import {
  normalizeAliases,
  normalizeCategory,
  normalizeSettingContent,
  normalizeSettingTitle,
} from "@/lib/write/work-input"

/**
 * 作品设定条目单条改删 —— /api/write/works/[id]/settings/[sid]。
 * 校验链:作品归属(非本人 404) → 条目存在且挂在该作品下(否则 404)。
 */

type RouteContext = { params: { id: string; sid: string } }

async function assertSetting(workId: string, sid: string, userId: string) {
  const work = await prisma.work.findFirst({
    where: { id: workId, userId },
    select: { id: true },
  })
  if (!work) return null
  return prisma.workSetting.findFirst({
    where: { id: sid, workId: work.id },
    select: { id: true },
  })
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "登录已失效，请重新登录后再试" }, { status: 401 })
  }

  const existing = await assertSetting(params.id, params.sid, userId)
  if (!existing) {
    return NextResponse.json({ error: "设定不存在" }, { status: 404 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const data: {
    category?: string
    title?: string
    aliases?: string
    content?: string
    enabled?: boolean
    sort?: number
  } = {}
  if (body.category !== undefined) data.category = normalizeCategory(body.category)
  if (body.title !== undefined) data.title = normalizeSettingTitle(body.title)
  if (body.aliases !== undefined) data.aliases = normalizeAliases(body.aliases)
  if (body.content !== undefined) data.content = normalizeSettingContent(body.content) ?? ""
  if (typeof body.enabled === "boolean") data.enabled = body.enabled
  if (typeof body.sort === "number" && Number.isFinite(body.sort)) data.sort = Math.round(body.sort)

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 })
  }

  const setting = await prisma.workSetting.update({
    where: { id: params.sid },
    data,
    select: {
      id: true,
      category: true,
      title: true,
      aliases: true,
      content: true,
      enabled: true,
      sort: true,
      updatedAt: true,
    },
  })
  return NextResponse.json(setting)
}

export async function DELETE(req: Request, { params }: RouteContext) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "登录已失效，请重新登录后再试" }, { status: 401 })
  }

  const existing = await assertSetting(params.id, params.sid, userId)
  if (!existing) {
    return NextResponse.json({ error: "设定不存在" }, { status: 404 })
  }

  await prisma.workSetting.delete({ where: { id: params.sid } })
  return NextResponse.json({ ok: true })
}
