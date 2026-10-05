import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { DiagnosticsView, type DiagEventView } from '@/components/diagnostics/DiagnosticsView'

/**
 * 手机端错误取证阅读页 —— /diagnostics
 *
 * 为什么存在:生产包 React #185 的堆栈被 minify 到只剩 react-dom 内部帧,且手机上看不到
 * 控制台。采集端(src/lib/client-diagnostics.ts)把"崩前那一秒谁在疯狂刷帧 + 动作面包屑"
 * 上报落库,这里原样摊开并给一条"复制"按钮,整段纯文本发回来就能排障。
 *
 * 无侧栏入口(不是日常功能,按需手输 URL);临时模式被 middleware 挡在门外。
 */

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '错误取证',
  robots: { index: false, follow: false },
}

export default async function DiagnosticsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const rows = await prisma.clientDiagEvent.findMany({
    orderBy: { lastAt: 'desc' },
    take: 60,
  })

  const events: DiagEventView[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    message: r.message,
    stack: r.stack,
    page: r.page,
    userAgent: r.userAgent,
    hits: r.hits,
    users: Array.isArray(r.userIds) ? (r.userIds as unknown[]).length : 0,
    firstAt: r.firstAt.toISOString(),
    lastAt: r.lastAt.toISOString(),
    context: (r.context ?? null) as DiagEventView['context'],
  }))

  return <DiagnosticsView events={events} />
}
