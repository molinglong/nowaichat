import { NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { getUserId } from '@/lib/api-auth'
import { prisma } from '@/lib/db'
import { monitor } from '@/lib/monitor'

/**
 * 浏览器端错误取证入库 —— 配套 src/lib/client-diagnostics.ts。
 *
 * 存在的理由:VPS 是只读挂载(/opt/aichatt-dist:/app:ro),fs 写日志必然 EROFS 静默失败,
 * 用户又在手机上看不见控制台,所以证据只能落 DB 再由 /diagnostics 页面读出来。
 *
 * 鉴权:复用双通道 getUserId。middleware 对未登录 /api/* 直接 401,所以登录页自身的
 * 崩溃收不到 —— 权衡后接受:换一个免鉴权写入口等于给公网开刷库口子。
 * 临时模式(isLoggedIn)可以上报,访客崩了同样要取证。
 *
 * 防线:体积上限、字段白名单+截断、单用户限速、按 hash 合并同类、总量裁剪。
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 200_000
const MAX_EVENTS_PER_REQUEST = 20
const MAX_ROWS = 300
const USER_HOURLY_QUOTA = 300

const quota = new Map<string, { start: number; n: number }>()
let writesSincePrune = 0

function withinQuota(userId: string): boolean {
  const now = Date.now()
  const entry = quota.get(userId)
  if (!entry || now - entry.start > 3_600_000) {
    quota.set(userId, { start: now, n: 1 })
    return true
  }
  entry.n++
  return entry.n <= USER_HOURLY_QUOTA
}

function str(value: unknown, cap: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > cap ? trimmed.slice(0, cap) : trimmed
}

/** hash 由客户端算(FNV-1a + 长度),这里只校验形状,不给自由文本当 key 的机会 */
function validHash(value: unknown): string | null {
  const s = str(value, 40)
  return s && /^[0-9a-f]{8}:\w+$/.test(s) ? s : null
}

const ALLOWED_KINDS = new Set(['react-loop', 'error', 'promise', 'console', 'chunk', 'stream', 'manual'])

type Incoming = {
  hash: string
  kind: string
  message: string
  stack: string | null
  page: string | null
  userAgent: string | null
  at: number
  context: Record<string, unknown>
}

function normalize(raw: unknown): Incoming | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const hash = validHash(e.hash)
  const message = str(e.message, 1000)
  if (!hash || !message) return null
  const kind = str(e.kind, 20)
  const at = typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : Date.now()

  // context 只收结构化字段,整体限幅:客户端已经截断过,这里兜底防刷
  const ctx = (e.context && typeof e.context === 'object' ? e.context : {}) as Record<string, unknown>
  const context: Record<string, unknown> = {
    crumbs: Array.isArray(ctx.crumbs) ? ctx.crumbs.slice(-120) : [],
    renders: ctx.renders && typeof ctx.renders === 'object' ? ctx.renders : {},
    renderRate: ctx.renderRate && typeof ctx.renderRate === 'object' ? ctx.renderRate : {},
    mutations: Array.isArray(ctx.mutations) ? ctx.mutations.slice(-30) : [],
    status: str(ctx.status, 40) ?? undefined,
    viewport: str(ctx.viewport, 40) ?? undefined,
    memory: str(ctx.memory, 40) ?? undefined,
    online: typeof ctx.online === 'boolean' ? ctx.online : undefined,
    dropped: typeof ctx.dropped === 'number' ? ctx.dropped : undefined,
  }

  return {
    hash,
    kind: kind && ALLOWED_KINDS.has(kind) ? kind : 'error',
    message,
    stack: str(e.stack, 4000),
    page: str(e.page, 200),
    userAgent: str(e.userAgent, 200),
    at: Math.min(Math.max(at, Date.UTC(2020, 0, 1)), Date.now() + 60_000),
    context,
  }
}

export async function POST(req: Request) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const text = await req.text().catch(() => '')
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: '证据包过大,已丢弃' }, { status: 413 })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  const rawEvents = (parsed as { events?: unknown })?.events
  if (!Array.isArray(rawEvents)) {
    return NextResponse.json({ error: 'no events' }, { status: 400 })
  }

  if (!withinQuota(userId)) {
    return NextResponse.json({ error: '限速' }, { status: 429 })
  }

  const events = rawEvents.slice(0, MAX_EVENTS_PER_REQUEST).map(normalize).filter((e): e is Incoming => !!e)
  if (!events.length) return NextResponse.json({ ok: true, stored: 0 })

  let stored = 0
  for (const e of events) {
    try {
      const existing = await prisma.clientDiagEvent.findUnique({
        where: { hash: e.hash },
        select: { id: true, hits: true, userIds: true, stack: true },
      })
      if (existing) {
        const ids = Array.isArray(existing.userIds) ? (existing.userIds as string[]) : []
        if (!ids.includes(userId)) ids.push(userId)
        await prisma.clientDiagEvent.update({
          where: { id: existing.id },
          data: {
            hits: { increment: 1 },
            lastAt: new Date(e.at),
            userIds: ids.slice(0, 50),
            // 最新一份证据永远覆盖旧的同 hash 快照:排障要的是"刚才这次"
            stack: e.stack ?? existing.stack,
            context: e.context as unknown as Prisma.InputJsonObject,
          },
        })
      } else {
        await prisma.clientDiagEvent.create({
          data: {
            hash: e.hash,
            kind: e.kind,
            message: e.message,
            stack: e.stack,
            page: e.page,
            userAgent: e.userAgent,
            userIds: [userId],
            context: e.context as unknown as Prisma.InputJsonObject,
            hits: 1,
            firstAt: new Date(e.at),
            lastAt: new Date(e.at),
          },
        })
      }
      stored++
    } catch (err) {
      // 单条写坏不影响整批:让客户端其余证据照样入库
      monitor('client_diag_write_failed', { hash: e.hash, kind: e.kind, message: String((err as Error)?.message ?? err).slice(0, 200) })
    }
  }

  // 裁剪:超过上限就删最旧的,保证表不会无限涨(取证场景不需要历史归档)
  writesSincePrune += stored
  if (writesSincePrune >= 20) {
    writesSincePrune = 0
    const cutoff = await prisma.clientDiagEvent
      .findMany({ orderBy: { lastAt: 'desc' }, skip: MAX_ROWS, take: 50, select: { id: true } })
      .then((rows) => rows.map((r) => r.id))
    if (cutoff.length) await prisma.clientDiagEvent.deleteMany({ where: { id: { in: cutoff } } })
  }

  monitor('client_diag_stored', { userId, stored, kinds: events.map((e) => e.kind).join(',') })
  return NextResponse.json({ ok: true, stored })
}

/** 清空取证(手机端"清噪音"用):不带 hash 全清,带 hash 单清 */
export async function DELETE(req: Request) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const hash = validHash(url.searchParams.get('hash'))

  if (hash) {
    const deleted = await prisma.clientDiagEvent.deleteMany({ where: { hash } })
    return NextResponse.json({ ok: true, deleted: deleted.count })
  }

  const deleted = await prisma.clientDiagEvent.deleteMany({})
  monitor('client_diag_cleared', { userId, deleted: deleted.count })
  return NextResponse.json({ ok: true, deleted: deleted.count })
}
