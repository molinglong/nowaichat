/**
 * 浏览器端错误取证采集器。
 *
 * 为什么不是"只传堆栈":生产包里 React #185(Maximum update depth exceeded)的 stack
 * 只会指向 react-dom 内部帧,看不到是谁在刷帧。真正能定元凶的是崩前的**渲染计数**
 * 与**面包屑**:哪个组件在流式期间每秒重渲染几十次、当时流式状态怎么跳、页面在哪。
 * 所以这里常驻采集这三样,出错时整包上传到 /api/client-diagnostics 落库。
 *
 * 纪律:
 * - 采集失败绝不影响主流程(全程 try/catch 静默);
 * - 不上传对话正文,只上传长度/状态/计数;
 * - 出站前统一脱敏(Key、Bearer、JWT、data URL、长 hex)并逐字段截断;
 * - 有预算:同一 hash 最多 3 次、单会话 30 次、60s 窗口 10 次,防止刷屏打爆服务器。
 */

import { useEffect } from 'react'

export type DiagKind = 'react-loop' | 'error' | 'promise' | 'console' | 'chunk' | 'stream' | 'manual'

interface Crumb {
  t: number
  k: string
  m: string
}

export interface DiagPayload {
  hash: string
  kind: DiagKind
  message: string
  stack?: string
  page?: string
  userAgent?: string
  at: number
  context: {
    crumbs: Crumb[]
    renders: Record<string, number>
    renderRate: Record<string, number>
    mutations: number[]
    status?: string
    viewport: string
    memory?: string
    online: boolean
    dropped: number
  }
}

const CRUMB_MAX = 90
const MESSAGE_MAX = 900
const STACK_MAX = 4000
const CRUMB_TEXT_MAX = 160
const PER_HASH_MAX = 3
const SESSION_BUDGET = 30
const WINDOW_BUDGET = 10
const WINDOW_MS = 60_000
const FLUSH_MS = 2500
const FLUSH_SIZE = 6
const BEACON_BYTE_LIMIT = 56_000
const STORM_PER_SEC = 25

let installed = false
let inConsoleHook = false
let sendFailedOnce = false
let dropped = 0
let sentEvents = 0
const seen = new Map<string, number>()
const crumbs: Crumb[] = []
const renderTotals = new Map<string, number>()
let bucketStart = 0
let bucketRenders = new Map<string, number>()
const mutationBuckets: number[] = []
let mutationCount = 0
const stormCooldown = new Map<string, number>()
let queue: DiagPayload[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let streamStatus = ''
let windowStart = 0
let windowCount = 0

/** FNV-1a: 服务端按这个 key 合并同类命中,不需要密码学强度 */
function hashOf(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + input.length.toString(36)
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_\-]{10,}/g, '[redacted-key]'],
  [/(?:Bearer|Authorization|x-api-key)\s*[:=]?\s*\S{8,}/gi, '[redacted-auth]'],
  [/eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{4,}/g, '[redacted-jwt]'],
  [/data:[^'"`\s]{40,}/g, '[redacted-data]'],
  [/\b[0-9a-f]{32,}\b/gi, '[hex]'],
  [/(?:password|passwd|secret|token)["'=:\s]+\S{4,}/gi, '[redacted-secret]'],
]

function sanitize(raw: unknown, cap: number): string {
  let s = typeof raw === 'string' ? raw : String(raw ?? '')
  for (const [re, to] of SECRET_PATTERNS) s = s.replace(re, to)
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > cap ? s.slice(0, cap) + '…' : s
}

/** /chat/c/cuid… 归一成 /chat/c/:id,避免同一 bug 因会话 id 分散成多条记录 */
function currentPage(): string {
  try {
    return location.pathname.replace(/\/(c|conv|id)\/[^/]+/g, '/$1/:id').replace(/\/\d{3,}\//g, '/:id/')
  } catch {
    return '?'
  }
}

export function addCrumb(kind: string, message: unknown): void {
  try {
    crumbs.push({ t: Date.now(), k: kind, m: sanitize(message, CRUMB_TEXT_MAX) })
    if (crumbs.length > CRUMB_MAX) crumbs.shift()
  } catch {
    /* 采集不许影响业务 */
  }
}

function rollBucket(now: number) {
  if (!bucketStart) {
    bucketStart = now
    return
  }
  const elapsed = now - bucketStart
  if (elapsed < 1000) return

  // 风暴判定:某个组件(名聚合了它的所有实例)一秒内刷帧超阈值
  bucketRenders.forEach((n, name) => {
    if (n >= STORM_PER_SEC) {
      const last = stormCooldown.get(name) ?? 0
      if (now - last > 5000) {
        stormCooldown.set(name, now)
        addCrumb('storm', `${name} 重渲染 ${n} 次/秒(阈值 ${STORM_PER_SEC})`)
      }
    }
  })
  mutationBuckets.push(mutationCount)
  if (mutationBuckets.length > 12) mutationBuckets.shift()
  mutationCount = 0
  bucketRenders = new Map()
  bucketStart = now
}

/** 渲染探针:组件每次 render 调一次,只做计数不触发 setState */
export function recordRender(name: string): void {
  try {
    const now = Date.now()
    renderTotals.set(name, (renderTotals.get(name) ?? 0) + 1)
    bucketRenders.set(name, (bucketRenders.get(name) ?? 0) + 1)
    rollBucket(now)
  } catch {
    /* noop */
  }
}

export function recordStreamStatus(status: string, extra?: string): void {
  if (status === streamStatus) return
  streamStatus = status
  addCrumb('stream', extra ? `${status} · ${extra}` : status)
}

function buildContext(): DiagPayload['context'] {
  const rate: Record<string, number> = {}
  bucketRenders.forEach((v, k) => {
    rate[k] = v
  })
  const totals: Record<string, number> = {}
  Array.from(renderTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .forEach(([k, v]) => {
      totals[k] = v
    })

  let memory: string | undefined
  const perfMem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory
  if (perfMem) {
    memory = `${(perfMem.usedJSHeapSize / 1048576).toFixed(0)}MB/${(perfMem.jsHeapSizeLimit / 1048576).toFixed(0)}MB`
  }

  return {
    crumbs: crumbs.slice(),
    renders: totals,
    renderRate: rate,
    mutations: mutationBuckets.slice(),
    status: streamStatus || undefined,
    viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
    memory,
    online: navigator.onLine,
    dropped,
  }
}

function sendNow() {
  flushTimer = null
  if (!queue.length) return
  const batch = queue
  queue = []
  const body = JSON.stringify({ events: batch })
  try {
    // 不带 keepalive:浏览器对 keepalive 请求有 64KB 硬上限,攒满一批(6 条 × 90 面包屑)
    // 会直接被拒,取证反而丢了。页面卸载那条路径由 pagehide 里的 sendBeacon 兜底。
    fetch('/api/client-diagnostics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
      .then((res) => {
        if (!res.ok && !sendFailedOnce) {
          sendFailedOnce = true
          addCrumb('diag', `上报失败 HTTP ${res.status}`)
        }
      })
      .catch(() => {
        if (!sendFailedOnce) {
          sendFailedOnce = true
          addCrumb('diag', '上报请求异常(已停止后续重试提示)')
        }
      })
  } catch {
    /* fetch 本身炸(离线) */
  }
}

function scheduleFlush() {
  if (queue.length >= FLUSH_SIZE) {
    if (flushTimer) clearTimeout(flushTimer)
    sendNow()
    return
  }
  if (flushTimer) return
  flushTimer = setTimeout(sendNow, FLUSH_MS)
}

export function reportDiagnostic(kind: DiagKind, message: unknown, stack?: unknown): void {
  try {
    const msg = sanitize(message, MESSAGE_MAX)
    const page = currentPage()
    // 循环更新是本次取证的头号目标:不论调用方标什么 kind,命中特征就归一到 react-loop
    const finalKind: DiagKind = isReactLoopText(msg) ? 'react-loop' : kind
    const hash = hashOf(`${finalKind}|${page}|${msg}`)
    const hits = (seen.get(hash) ?? 0) + 1
    seen.set(hash, hits)
    if (hits > PER_HASH_MAX) {
      dropped++
      return
    }

    const now = Date.now()
    if (sentEvents >= SESSION_BUDGET) {
      dropped++
      return
    }
    if (now - windowStart > WINDOW_MS) {
      windowStart = now
      windowCount = 0
    }
    windowCount++
    if (windowCount > WINDOW_BUDGET) {
      dropped++
      return
    }
    sentEvents++

    const payload: DiagPayload = {
      hash,
      kind: finalKind,
      message: msg,
      stack: stack ? sanitize(stack, STACK_MAX) : undefined,
      page,
      userAgent: sanitize(navigator.userAgent, 200),
      at: now,
      context: buildContext(),
    }
    addCrumb('report', `${kind}: ${msg}`.slice(0, CRUMB_TEXT_MAX))
    queue.push(payload)
    scheduleFlush()
  } catch {
    /* 采集不许影响业务 */
  }
}

function isReactLoopText(s: string): boolean {
  return (
    s.includes('Minified React error #185') ||
    s.includes('Maximum update depth') ||
    s.includes('Too many re-renders') ||
    s.includes('Minified React error #301') ||
    s.includes('Cannot update a component while rendering')
  )
}

/**
 * 装采集器。挂在 Providers 客户端根组件的 effect 里,全站生效。
 * 生产包也生效 —— 这正是它存在的意义(开发期已有 ReactErrorLogger)。
 */
export function installDiagnostics(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  windowStart = Date.now()
  bucketStart = Date.now()

  addCrumb('nav', `会话启动 ${currentPage()}`)

  window.addEventListener(
    'error',
    (event) => {
      // 有 error 属性=JS 异常;没有的多半是资源加载失败(重新部署后旧 chunk 404 会白屏)
      if (event.error) {
        const message = event.error.message ?? event.message
        reportDiagnostic(isReactLoopText(String(message)) ? 'react-loop' : 'error', message, event.error.stack)
      } else if (event.message) {
        const text = String(event.message)
        if (/chunk|Loading failed|import/i.test(text)) reportDiagnostic('chunk', text)
        else addCrumb('resource', text)
      }
    },
    true
  )

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message = reason?.message ?? String(reason ?? 'unknown rejection')
    reportDiagnostic('promise', message, reason?.stack)
  })

  const originalError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    try {
      if (!inConsoleHook) {
        inConsoleHook = true
        const first = typeof args[0] === 'string' ? args[0] : args[0] instanceof Error ? args[0].message : ''
        if (isReactLoopText(first)) {
          const stackArg = args.find((a) => a instanceof Error) as Error | undefined
          reportDiagnostic('react-loop', first + ' ' + sanitize(args.slice(1).join(' '), 300), stackArg?.stack ?? new Error('loop').stack)
        } else if (typeof first === 'string' && /error|failed|exception/i.test(first) && !/\[MONITOR\]|ReactErrorLogger/.test(first)) {
          // 其余 console.error 只记面包屑,不建记录:数量太大且信噪比低
          addCrumb('console', first)
        }
      }
    } catch {
      /* noop */
    } finally {
      inConsoleHook = false
    }
    originalError(...args)
  }

  // 翻页留痕:SPA 软导航不触发 window error 之外的上下文,面包屑需要这条
  const pushNav = () => addCrumb('nav', currentPage())
  window.addEventListener('popstate', pushNav)
  const originalPush = history.pushState.bind(history)
  history.pushState = ((...args: Parameters<typeof history.pushState>) => {
    originalPush(...args)
    pushNav()
  }) as typeof history.pushState
  const originalReplace = history.replaceState.bind(history)
  history.replaceState = ((...args: Parameters<typeof history.replaceState>) => {
    originalReplace(...args)
    pushNav()
  }) as typeof history.replaceState

  document.addEventListener('visibilitychange', () => addCrumb('visibility', document.visibilityState))
  window.addEventListener('offline', () => addCrumb('network', '离线'))
  window.addEventListener('online', () => addCrumb('network', '恢复在线'))

  // DOM 突变速率:流式渲染风暴时最直观的旁证(每秒新增/移除节点数)
  try {
    const observer = new MutationObserver((records) => {
      let n = 0
      for (const r of records) n += r.addedNodes.length + r.removedNodes.length
      mutationCount += n
    })
    observer.observe(document.body, { childList: true, subtree: true })
  } catch {
    /* 老浏览器没有 body 或没有 MO */
  }

  // 桶推进要有心跳:纯空闲时也要收风暴,否则每秒统计只在渲染时推进
  const heartbeat = setInterval(rollBucket, 1000)

  window.addEventListener('pagehide', () => {
    clearInterval(heartbeat)
    if (!queue.length) return
    // 页面即将卸载,fetch 不可靠,用 beacon 兜底(有 64KB 限制,超了先削面包屑)
    let body = JSON.stringify({ events: queue })
    if (body.length > BEACON_BYTE_LIMIT) {
      const slim = queue.map((e) => ({ ...e, context: { ...e.context, crumbs: e.context.crumbs.slice(-20) }, stack: undefined }))
      body = JSON.stringify({ events: slim })
    }
    try {
      navigator.sendBeacon('/api/client-diagnostics', new Blob([body], { type: 'application/json' }))
    } catch {
      /* beacon 不可用就放弃这次兜底 */
    }
  })

  // 手工注入口:冒烟测试与现场排障用 window.__diag.report('manual', '...') 造证据
  ;(window as unknown as { __diag: unknown }).__diag = {
    report: reportDiagnostic,
    crumb: addCrumb,
    render: recordRender,
    snapshot: buildContext,
    flush: sendNow,
  }
}

/**
 * 渲染探针:组件函数体首行调用一次,统计它的 render 次数(含 memo 实例聚合)。
 * 只写计数器不触发 setState,所以本身不会引入新的更新。
 */
export function useRenderProbe(name: string): void {
  recordRender(name)
}

/** error.tsx 用:把接住的渲染错误转成取证上报(memo 实例聚合) */
export function useReportRenderError(error: Error & { digest?: string }, scope: string): void {
  useEffect(() => {
    reportDiagnostic('error', `[${scope}] ${error.message}${error.digest ? ` digest=${error.digest}` : ''}`, error.stack)
  }, [error, scope])
}
