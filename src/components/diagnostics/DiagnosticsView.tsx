'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Trash2, Check, AlertTriangle } from 'lucide-react'

export interface DiagEventView {
  id: string
  kind: string
  message: string
  stack: string | null
  page: string | null
  userAgent: string | null
  hits: number
  users: number
  firstAt: string
  lastAt: string
  context: {
    crumbs?: Array<{ t: number; k: string; m: string }>
    renders?: Record<string, number>
    renderRate?: Record<string, number>
    mutations?: number[]
    status?: string
    viewport?: string
    memory?: string
    online?: boolean
    dropped?: number
  } | null
}

function fmt(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

/** 把一条证据拍平成可直接粘进对话的纯文本,手机上不用截图也能读全 */
function toPlainText(e: DiagEventView): string {
  const lines: string[] = []
  lines.push(`[${e.kind}] ${e.message}`)
  lines.push(`时间 ${fmt(e.lastAt)}(首次 ${fmt(e.firstAt)}) · 命中 ${e.hits} 次 · 影响用户 ${e.users} 人`)
  if (e.page) lines.push(`页面 ${e.page}${e.context?.viewport ? ` · 视口 ${e.context.viewport}` : ''}`)
  if (e.context?.status) lines.push(`流式状态 ${e.context.status}${e.context.online === false ? ' · 离线' : ''}`)
  if (e.context?.memory) lines.push(`JS 堆 ${e.context.memory}`)

  const renders = Object.entries(e.context?.renders ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 10)
  if (renders.length) lines.push(`渲染总次数 Top: ${renders.map(([k, v]) => `${k}=${v}`).join('  ')}`)
  const rate = Object.entries(e.context?.renderRate ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 10)
  if (rate.length) lines.push(`崩前那一秒: ${rate.map(([k, v]) => `${k}=${v}/s`).join('  ')}`)
  if (e.context?.mutations?.length) lines.push(`DOM 突变速率(近 ${e.context.mutations.length} 秒): ${e.context.mutations.join(',')}`)

  const crumbs = e.context?.crumbs ?? []
  if (crumbs.length) {
    lines.push('— 面包屑(崩溃前动作轨迹) —')
    for (const c of crumbs) lines.push(`  ${fmt(new Date(c.t).toISOString())} [${c.k}] ${c.m}`)
  }
  if (e.stack) {
    lines.push('— 堆栈 —')
    lines.push(e.stack)
  }
  if (e.userAgent) lines.push(`UA ${e.userAgent}`)
  if (e.context?.dropped) lines.push(`(本次会话另有 ${e.context.dropped} 条被预算/去重丢弃)`)
  return lines.join('\n')
}

const KIND_STYLE: Record<string, string> = {
  'react-loop': 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  error: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
  promise: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  chunk: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
  stream: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
}

export function DiagnosticsView({ events }: { events: DiagEventView[] }) {
  const router = useRouter()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function copy(e: DiagEventView) {
    const text = toPlainText(e)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // 非安全上下文/浏览器禁用剪贴板时,退化成选中文本让用户手动复制
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      document.body.removeChild(area)
    }
    setCopiedId(e.id)
    setTimeout(() => setCopiedId((cur) => (cur === e.id ? null : cur)), 1500)
  }

  function clearAll() {
    if (!confirm('清空全部取证记录?')) return
    startTransition(async () => {
      await fetch('/api/client-diagnostics', { method: 'DELETE' }).catch(() => {})
      router.refresh()
    })
  }

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto max-w-3xl p-4 space-y-3">
        <header className="flex items-start justify-between gap-3 pb-1">
          <div>
            <h1 className="text-lg font-semibold text-content-primary">错误取证</h1>
            <p className="text-xs text-content-muted leading-relaxed mt-1">
              浏览器端崩溃/循环更新的现场证据。点开条目看「复制」，把纯文本整段发给 agent 即可排障。
            </p>
          </div>
          {events.length > 0 && (
            <button
              onClick={clearAll}
              disabled={pending}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-subtle text-content-secondary text-xs transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              清噪音
            </button>
          )}
        </header>

        {events.length === 0 ? (
          <div className="py-16 text-center text-sm text-content-muted">
            暂无取证记录。复现一次崩溃后再回来看。
          </div>
        ) : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="rounded-lg border border-line bg-surface-muted p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${KIND_STYLE[e.kind] ?? 'bg-surface-subtle text-content-secondary'}`}>
                    {e.kind}
                  </span>
                  <span className="text-[11px] text-content-muted tabular-nums">{fmt(e.lastAt)}</span>
                  {e.hits > 1 && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-subtle text-content-secondary">x{e.hits}</span>
                  )}
                  {e.context?.status && (
                    <span className="text-[11px] text-content-muted">流式:{e.context.status}</span>
                  )}
                  <button
                    onClick={() => copy(e)}
                    className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded bg-surface hover:bg-surface-subtle text-[11px] text-content-secondary transition-colors"
                  >
                    {copiedId === e.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedId === e.id ? '已复制' : '复制'}
                  </button>
                </div>

                <p className="mt-2 text-[13px] leading-snug break-words text-content-primary">{e.message}</p>

                {e.page && <p className="mt-1 text-[11px] text-content-muted break-all">{e.page}</p>}

                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-content-secondary select-none">
                    现场（渲染计数 / 面包屑 / 堆栈）
                  </summary>
                  <div className="mt-2 space-y-2 text-[11px] leading-relaxed">
                    {Object.keys(e.context?.renders ?? {}).length > 0 && (
                      <div>
                        <div className="text-content-muted mb-0.5">渲染总次数 Top</div>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(e.context?.renders ?? {})
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 12)
                            .map(([name, n]) => (
                              <span
                                key={name}
                                className={`px-1.5 py-0.5 rounded ${n > 200 ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-surface-subtle text-content-secondary'}`}
                              >
                                {name}={n}
                              </span>
                            ))}
                        </div>
                      </div>
                    )}
                    {Object.keys(e.context?.renderRate ?? {}).length > 0 && (
                      <div className="text-content-muted">
                        崩前那一秒:{' '}
                        {Object.entries(e.context?.renderRate ?? {})
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 8)
                          .map(([k, v]) => `${k}=${v}/s`)
                          .join('  ')}
                      </div>
                    )}
                    {!!e.context?.mutations?.length && (
                      <div className="text-content-muted tabular-nums">
                        DOM 突变速率(近 {e.context.mutations.length} 秒): {e.context.mutations.join(', ')}
                      </div>
                    )}
                    {!!e.context?.crumbs?.length && (
                      <div>
                        <div className="text-content-muted mb-0.5">面包屑</div>
                        <ol className="space-y-0.5">
                          {e.context.crumbs.map((c, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-content-muted tabular-nums shrink-0">{fmt(new Date(c.t).toISOString())}</span>
                              <span className="text-content-secondary shrink-0">[{c.k}]</span>
                              <span className="break-words text-content-primary">{c.m}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {e.stack && (
                      <pre className="max-h-60 overflow-auto rounded bg-surface p-2 text-[10px] leading-snug whitespace-pre-wrap break-all text-content-secondary">
                        {e.stack}
                      </pre>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}

        <p className="pt-2 pb-6 text-[11px] text-content-muted flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          取证不含对话正文，密钥与长 token 已在浏览器侧脱敏；同一问题最多记 3 次，超出只涨命中数。
        </p>
      </div>
    </div>
  )
}
