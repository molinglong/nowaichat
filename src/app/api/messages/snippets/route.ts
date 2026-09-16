import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * 根据关键词获取若干会话内"匹配命中"的消息片段。
 * 每个会话最多返回 1 条最早命中的消息(适合做结果预览)。
 *
 * 入参:
 *   - convIds: 逗号分隔的会话 id,上限 50 个
 *   - q: 关键词,1~200 字符
 *   - limit: 每会话最多返回多少条,默认 1,上限 3
 *   - context: 关键词前后保留多少字符,默认 40,上限 100
 *
 * 出参:
 *   {
 *     fragments: Array<{
 *       conversationId: string
 *       messageId: string
 *       role: string       // user | assistant | system
 *       snippet: string    // 截断后片段,含前后省略号
 *     }>
 *   }
 */
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const convIdsParam = (searchParams.get('convIds') ?? '').trim()
  const q = (searchParams.get('q') ?? '').trim()
  const parsedLimit = parseInt(searchParams.get('limit') ?? '1', 10)
  const parsedContext = parseInt(searchParams.get('context') ?? '40', 10)
  const perConv = Math.min(
    Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 1,
    3
  )
  const contextLen = Math.min(
    Number.isFinite(parsedContext) && parsedContext >= 0 ? parsedContext : 40,
    100
  )

  if (!convIdsParam) {
    return NextResponse.json({ fragments: [] })
  }
  const convIds = convIdsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50)
  if (convIds.length === 0 || !q) {
    return NextResponse.json({ fragments: [] })
  }
  if (q.length > 200) {
    return NextResponse.json({ error: 'q too long' }, { status: 400 })
  }

  // 防御性: 先确认这些会话都属于当前用户,避免越权查询。
  const ownedCount = await prisma.conversation.count({
    where: { id: { in: convIds }, userId: session.user.id },
  })
  if (ownedCount !== convIds.length) {
    // 用户越权访问了不属于他的会话,直接返回空。
    return NextResponse.json({ fragments: [] })
  }

  // 取每会话最早命中的一条消息(limit 略大于会话数,再按 conversationId 分组取第一条)
  const matched = await prisma.message.findMany({
    where: {
      conversationId: { in: convIds },
      // C 分支轻量版: 归档消息不参与全局搜索
      archived: false,
      content: { contains: q, mode: 'insensitive' },
    },
    select: {
      id: true,
      conversationId: true,
      role: true,
      content: true,
      createdAt: true,
    },
    orderBy: [{ conversationId: 'asc' }, { createdAt: 'asc' }],
    take: convIds.length * perConv,
  })

  // 按 conversationId 分组,每个会话只保留 perConv 条最早的
  const grouped = new Map<
    string,
    Array<{ id: string; role: string; content: string; createdAt: Date }>
  >()
  for (const m of matched) {
    const arr = grouped.get(m.conversationId) ?? []
    if (arr.length < perConv) {
      arr.push({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })
      grouped.set(m.conversationId, arr)
    }
  }

  const fragments = Array.from(grouped.entries()).flatMap(([conversationId, msgs]) =>
    msgs.map((m) => ({
      conversationId,
      messageId: m.id,
      role: m.role,
      snippet: truncateSnippet(m.content, q, contextLen),
    }))
  )

  return NextResponse.json({ fragments })
}

/**
 * 在 content 里找关键词出现的位置,保留前后 contextLen 字符上下文,
 * 并用 "…" 标注截断。关键词不区分大小写;命中失败时退化为头部截断。
 */
function truncateSnippet(content: string, q: string, contextLen: number): string {
  if (!content) return ''
  const maxTotal = contextLen * 2 + q.length
  if (content.length <= maxTotal) return content

  const lower = content.toLowerCase()
  const ql = q.toLowerCase()
  const idx = lower.indexOf(ql)
  if (idx === -1) {
    return content.slice(0, maxTotal) + '…'
  }

  const start = Math.max(0, idx - contextLen)
  const end = Math.min(content.length, idx + q.length + contextLen)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < content.length ? '…' : ''
  return prefix + content.slice(start, end) + suffix
}
