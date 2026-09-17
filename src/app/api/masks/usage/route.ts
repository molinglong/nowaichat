import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * GET /api/masks/usage
 *
 * 统计当前用户各面具(masks)下的对话数，按次数降序返回。
 * 只返回 count > 0 的分组(groupBy 天然行为)，供搜索对话框的
 * 面具筛选胶囊做「最常用优先」的折叠排序。
 * 「无面具」的对话数不在此统计(该胶囊固定排在末位，不参与排序)。
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const groups = await prisma.conversation.groupBy({
    by: ['maskId'],
    where: { userId: session.user.id, maskId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { maskId: 'desc' } },
  })

  return NextResponse.json({
    usage: groups.map((g) => ({ maskId: g.maskId as string, count: g._count._all })),
  })
}
