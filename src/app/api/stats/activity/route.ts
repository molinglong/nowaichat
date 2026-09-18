/**
 * GET /api/stats/activity?weeks=14
 * 返回用户最近 N 周的活跃度热力数据（仅统计 user 角色消息数）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export interface ActivityStatResponse {
  /** 过去 N 周每天的活跃记录 [{ date: 'YYYY-MM-DD', count: number }, ...] */
  days: Array<{ date: string; count: number }>
  /** 总活跃天数 */
  totalDays: number
  /** 当前连续活跃天数（今天有记录且倒数连续） */
  currentStreak?: number
}

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const weeks = Number(url.searchParams.get('weeks') ?? 14)
    if (!Number.isFinite(weeks) || weeks < 1 || weeks > 52) {
      return NextResponse.json({ error: 'Invalid weeks' }, { status: 400 })
    }

    // 计算起始日期（含今天）
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - (weeks * 7 - 1))

    // Prisma：按天聚合 user 消息数（UTC-8 时区对齐前端显示）
    const raw = await prisma.message.groupBy({
      by: ['createdAt'],
      where: {
        conversation: {
          userId: session.user.id,
        },
        role: 'user',
        createdAt: { gte: start, lte: end },
      },
      _count: true,
    })

    // 转为 {date: count} map（date 取 'YYYY-MM-DD'）
    const dailyMap = new Map<string, number>()
    for (const r of raw) {
      const dateStr = r.createdAt.toISOString().slice(0, 10)
      dailyMap.set(dateStr, (dailyMap.get(dateStr) ?? 0) + r._count)
    }

    // 生成完整日序列（包括零值），避免断档让热力图好看
    const days: Array<{ date: string; count: number }> = []
    let totalDays = 0
    let currentStreak = 0
    let isStreakStarted = false

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10)
      const count = dailyMap.get(dateStr) ?? 0
      days.push({ date: dateStr, count })
      if (count > 0) {
        totalDays += 1
        // 逆序计算 streak：如果今天或之前有记录，则连续
      }
    }
    // 逆序计算 streak
    for (let i = days.length - 1; i >= 0; i--) {
      const count = days[i].count
      if (count > 0) {
        currentStreak += 1
      } else {
        break // 中断就停
      }
    }

    return NextResponse.json({
      days,
      totalDays,
      currentStreak: currentStreak > 0 ? currentStreak : undefined,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
