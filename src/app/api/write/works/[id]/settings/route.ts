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
 * 作品设定条目列表/新建 —— /api/write/works/[id]/settings。
 * 单条改删见 /api/write/works/[id]/settings/[sid]。
 * 所有操作先校验作品归属(非本人 404),再落库。
 */

type RouteContext = { params: { id: string } }

export async function GET(req: Request, { params }: RouteContext) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const work = await prisma.work.findFirst({
    where: { id: params.id, userId },
    select: { id: true },
  })
  if (!work) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 })
  }

  const settings = await prisma.workSetting.findMany({
    where: { workId: work.id },
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
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
    take: 500,
  })

  return NextResponse.json({ settings })
}

export async function POST(req: Request, { params }: RouteContext) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const work = await prisma.work.findFirst({
    where: { id: params.id, userId },
    select: { id: true },
  })
  if (!work) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const content = normalizeSettingContent(body.content)

  const count = await prisma.workSetting.count({ where: { workId: work.id } })
  const setting = await prisma.workSetting.create({
    data: {
      workId: work.id,
      category: normalizeCategory(body.category),
      title: normalizeSettingTitle(body.title),
      aliases: normalizeAliases(body.aliases),
      content: content ?? "",
      sort: count,
    },
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

  return NextResponse.json(setting, { status: 201 })
}
