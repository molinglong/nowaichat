import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * 管理员 API 通用守卫。返回 NextResponse 表示被拦（401 未登录 / 403 非管理员），
 * 返回字符串表示放行的 userId。
 *
 * 验权一律按 DB 实时 role，不信任 JWT 里的 role（旧 token 可能没有，也可能过期
 * 失真）；JWT role 只作设置页入口显隐。临时模式由 middleware 对 /api/quota/admin*
 * 前置拦截，这里作第二道防线。
 */
export async function guardAdmin(): Promise<NextResponse | string> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: '登录已失效，请重新登录后再试' }, { status: 401 })
  }
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })
  if (me?.role !== 'admin') {
    return NextResponse.json({ error: '无权访问' }, { status: 403 })
  }
  return session.user.id
}

/** Key 掩码：只露头 4 + 尾 4，中间打码；短 key 全打码。API 出参绝不带明文 */
export function maskSecret(key: string): string {
  if (key.length <= 10) return '••••••'
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`
}
