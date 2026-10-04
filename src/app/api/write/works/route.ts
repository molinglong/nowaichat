import { NextResponse } from "next/server"
import { getUserId } from "@/lib/api-auth"
import { prisma } from "@/lib/db"
import { normalizeWorkDescription, normalizeWorkTitle } from "@/lib/write/work-input"

/**
 * 写作作品(Work) CRUD —— /api/write/works。
 *
 * 作品是长篇写作的上下文容器:设定条目挂作品层,作品下归属多篇文档(章节),
 * 生成时按预算注入设定(见 lib/write/work-settings.ts),解跨章吃书。
 * 单作品改删见 /api/write/works/[id];设定条目见 /api/write/works/[id]/settings。
 *
 * 鉴权:与 /api/write/docs 同规则(双通道),所有查询按 userId 过滤防越权。
 */

export async function GET(req: Request) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "登录已失效，请重新登录后再试" }, { status: 401 })
  }

  const works = await prisma.work.findMany({
    where: { userId },
    select: {
      id: true,
      title: true,
      description: true,
      settingsEnabled: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { settings: true, docs: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  })

  return NextResponse.json({
    works: works.map(({ _count, ...w }) => ({
      ...w,
      settingCount: _count.settings,
      docCount: _count.docs,
    })),
  })
}

export async function POST(req: Request) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "登录已失效，请重新登录后再试" }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const work = await prisma.work.create({
    data: {
      userId,
      title: normalizeWorkTitle(body.title),
      description: normalizeWorkDescription(body.description),
    },
    select: {
      id: true,
      title: true,
      description: true,
      settingsEnabled: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({ ...work, settingCount: 0, docCount: 0 }, { status: 201 })
}
