'use client'

/**
 * 服务商模型管理卡片 —— 渲染 manage_provider_models 工具产出的模型操作，
 * 用户点击确认后才通过 /api/provider-models 写入（与设置面板手动操作同端点、同校验）。
 *
 * 状态模型（数据驱动，天然解决历史回放）：
 * - 流式(input-streaming): 骨架占位
 * - 待确认: 操作列表 + 确认按钮；任一项不可执行（未知服务商/非内置/记录缺失）则整体禁用并标注原因
 * - 已存在/已执行: 依据覆盖记录与内置目录的目标态判断（isProviderModelOpSatisfied），
 *   刷新/回放后按钮态依然正确，无需持久化"已执行"标记
 *
 * 删除防护（仅 remove 动作，两层）：
 * 1. 二次确认：点击「确认移除」后展开确认区
 * 2. 计算题：1-100 内加法（如 23 + 28 = ?），答对才发 DELETE 请求
 * 防误触设计（操作者即本人），不承担防攻击职责。
 */
import { memo, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Cpu, Eye, EyeOff, Loader2, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchJson } from '@/lib/query/fetcher'
import { queryKeys, STALE } from '@/lib/query/keys'
import { toast } from '@/lib/toast'
import { detectModelCapabilities } from '@/lib/ai/model-capabilities'
import {
  PROVIDER_MODEL_ACTION_LABELS,
  describeProviderModelOp,
  describeProviderModelOpResult,
  isProviderModelOpSatisfied,
  toProviderModelOps,
  type ProviderModelOp,
} from '@/lib/ai/provider-model-tool'
import type { ToolCallView } from './ToolCallCard'

/** GET /api/provider-models 的响应形状（卡片只消费其中两段） */
interface ProviderModelsResponse {
  providerOverrides: Array<{
    id: string
    provider: string
    modelId: string
    isHidden: boolean
    name: string
    contextWindow: number
    supportsVision: boolean
    supportsFiles: boolean
    supportsReasoning: boolean
  }>
  builtinCatalog?: Array<{ id: string; name: string; models: string[] }>
}

const DEFAULT_CONTEXT_WINDOW = 32768

/** 1-100 内加法挑战（如 1+11 / 9+12 / 23+28），结果 12-99 */
function makeChallenge(): { a: number; b: number } {
  return {
    a: 11 + Math.floor(Math.random() * 40), // 11-50
    b: 1 + Math.floor(Math.random() * 49), // 1-49
  }
}

/** 上下文窗口紧凑展示：1000000 → 1M，32768 → 32K */
function formatContextWindow(n: number): string {
  if (n >= 1_000_000) return `${Math.round((n / 1_000_000) * 10) / 10}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}

function ActionIcon({ action, className }: { action: ProviderModelOp['action']; className?: string }) {
  switch (action) {
    case 'add':
      return <Plus className={className} />
    case 'remove':
      return <Trash2 className={className} />
    case 'hide':
      return <EyeOff className={className} />
    case 'unhide':
      return <Eye className={className} />
  }
}

interface ProviderModelCardProps {
  view: ToolCallView
}

function ProviderModelCardInner({ view }: ProviderModelCardProps) {
  const ops = useMemo(() => toProviderModelOps(view.input), [view.input])
  const isStreaming = view.state === 'input-streaming'
  const queryClient = useQueryClient()

  // 覆盖记录 + 内置目录：执行前的可执行性判断与执行后的终态判断共用
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.providerModels(),
    queryFn: () => fetchJson<ProviderModelsResponse>('/api/provider-models'),
    staleTime: STALE.providers,
  })
  // rows/catalog 各自 useMemo：直接 `?? []` 会在每次渲染产生新数组，令下游 useMemo 依赖失效
  const rows = useMemo(() => data?.providerOverrides ?? [], [data])
  const catalog = useMemo(() => data?.builtinCatalog ?? [], [data])

  // idle=待确认 confirm=删除二次确认 executing=执行中 error=失败（可重试）
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'executing' | 'error'>('idle')
  const [challenge, setChallenge] = useState<{ a: number; b: number } | null>(null)
  const [answer, setAnswer] = useState('')
  const [answerWrong, setAnswerWrong] = useState(false)
  const [execError, setExecError] = useState<string | null>(null)

  const builtinIds = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const p of catalog) map.set(p.id, new Set(p.models))
    return map
  }, [catalog])

  // 逐项可执行性：satisfied=目标态已达成（覆盖记录或内置目录）；blocked=不可执行原因（仅对未达成项）
  const blocks = useMemo(() => {
    return ops.map((op) => {
      const satisfied = isProviderModelOpSatisfied(op, rows, builtinIds.get(op.provider))
      let blocked: string | undefined
      if (!satisfied && !isLoading) {
        const known = builtinIds.has(op.provider) || catalog.length === 0
        const row = rows.find((r) => r.provider === op.provider && r.modelId === op.modelId)
        if (!known) blocked = '未知服务商，不可执行'
        else if (op.action === 'hide' && !builtinIds.get(op.provider)?.has(op.modelId))
          blocked = '该模型不是内置模型，无法隐藏'
        else if (op.action === 'unhide' && (!row || !row.isHidden)) blocked = '该模型当前未被隐藏'
        else if (op.action === 'remove' && !row) blocked = '未找到该模型的记录'
      }
      return { op, satisfied, blocked }
    })
  }, [ops, rows, catalog, builtinIds, isLoading])

  const pending = blocks.filter((b) => !b.satisfied)
  const allSatisfied = ops.length > 0 && pending.length === 0
  const hasBlocked = pending.some((b) => b.blocked)
  const hasRemove = pending.some((b) => b.op.action === 'remove')

  /** 执行全部未完成操作（先实时拉一次覆盖记录，避免缓存过期导致 POST 撞 P2002） */
  async function execute() {
    setPhase('executing')
    setExecError(null)
    try {
      const fresh = await fetchJson<ProviderModelsResponse>('/api/provider-models')
      const freshRows = fresh.providerOverrides ?? []
      for (const { op } of pending) {
        const existing = freshRows.find(
          (r) => r.provider === op.provider && r.modelId === op.modelId
        )
        if (op.action === 'add' || op.action === 'hide') {
          const detected = detectModelCapabilities(op.modelId)
          await fetchJson('/api/provider-models', {
            method: 'POST',
            json: {
              ...(existing ? { id: existing.id } : {}),
              provider: op.provider,
              modelId: op.modelId,
              isHidden: op.action === 'hide',
              name: op.action === 'hide' ? '' : op.name?.trim() || op.modelId,
              contextWindow: op.contextWindow ?? existing?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
              supportsVision: op.supportsVision ?? existing?.supportsVision ?? detected.supportsVision,
              supportsFiles: op.supportsFiles ?? existing?.supportsFiles ?? detected.supportsFiles,
              supportsReasoning:
                op.supportsReasoning ?? existing?.supportsReasoning ?? detected.supportsReasoning,
            },
          })
        } else {
          if (!existing) {
            throw new Error(
              op.action === 'remove' ? '未找到要移除的模型记录' : '该模型未被隐藏，无需恢复'
            )
          }
          await fetchJson(`/api/provider-models?id=${encodeURIComponent(existing.id)}`, {
            method: 'DELETE',
          })
        }
      }
      toast.success(pending.map((b) => describeProviderModelOpResult(b.op)).join('；'))
    } catch (err) {
      setPhase('error')
      setExecError(err instanceof Error ? err.message : '执行失败')
      toast.error(err instanceof Error ? err.message : '模型操作失败')
    } finally {
      // 成败都刷新：部分失败时让本地与库对齐，重试只跑真正未完成的项（幂等安全）
      await queryClient.invalidateQueries({ queryKey: queryKeys.providerModels() })
      await queryClient.invalidateQueries({ queryKey: queryKeys.providers() })
    }
  }

  function handlePrimaryClick() {
    if (hasBlocked || pending.length === 0) return
    if (hasRemove) {
      // 第一层防护：进入二次确认（展开计算题）
      setChallenge(makeChallenge())
      setAnswer('')
      setAnswerWrong(false)
      setPhase('confirm')
      return
    }
    void execute()
  }

  function handleChallengeSubmit() {
    if (!challenge) return
    if (Number(answer.trim()) !== challenge.a + challenge.b) {
      setAnswerWrong(true)
      return
    }
    void execute()
  }

  // ---- 流式 / 数据校验中 ----
  if (isStreaming || (isLoading && ops.length > 0)) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-line/60 bg-surface-muted px-2.5 py-1.5 text-xs text-content-muted">
        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        <span>{isStreaming ? '正在准备模型操作…' : '正在核对当前模型配置…'}</span>
      </div>
    )
  }

  // ---- 历史数据缺字段 ----
  if (ops.length === 0) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-line/60 bg-surface-muted px-2.5 py-1.5 text-xs text-content-muted">
        <Cpu className="w-3.5 h-3.5 shrink-0" />
        <span>模型操作信息不完整</span>
      </div>
    )
  }

  // ---- 已执行（数据驱动：目标态已达成，刷新/回放后依然成立） ----
  if (allSatisfied) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-line/60 bg-surface-muted px-2.5 py-1.5 text-xs">
        <Check className="w-3.5 h-3.5 shrink-0 text-content-muted" />
        <span
          className="min-w-0 truncate text-content-secondary"
          title={blocks.map((b) => describeProviderModelOpResult(b.op)).join('；')}
        >
          {blocks.map((b) => describeProviderModelOpResult(b.op)).join('；')}
        </span>
      </div>
    )
  }

  const primaryLabel =
    phase === 'executing'
      ? '执行中…'
      : pending.length === 1
        ? `确认${PROVIDER_MODEL_ACTION_LABELS[pending[0].op.action]}`
        : '确认执行'

  return (
    <div className="rounded-lg border border-line/60 bg-surface-muted overflow-hidden text-xs">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-content-secondary border-b border-line/40">
        <Cpu className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0 truncate">服务商模型</span>
        <span className="ml-auto shrink-0 text-[10px] text-content-muted">
          {pending.length} 项待确认
        </span>
      </div>

      <div className="px-2.5 py-2 flex flex-col gap-2">
        <ul className="flex flex-col gap-1.5">
          {blocks.map(({ op, satisfied, blocked }, i) => {
            // 能力标签与执行口径保持一致：AI 显式 > 既有记录 > 按模型名自动检测
            const existingRow = rows.find(
              (r) => r.provider === op.provider && r.modelId === op.modelId
            )
            const detected = detectModelCapabilities(op.modelId)
            const caps: string[] = []
            if (op.action === 'add') {
              if (op.supportsVision ?? existingRow?.supportsVision ?? detected.supportsVision) caps.push('读图')
              if (op.supportsReasoning ?? existingRow?.supportsReasoning ?? detected.supportsReasoning)
                caps.push('思考')
              if (op.supportsFiles ?? existingRow?.supportsFiles ?? detected.supportsFiles) caps.push('文件')
              const ctx = op.contextWindow ?? existingRow?.contextWindow
              if (ctx && ctx !== DEFAULT_CONTEXT_WINDOW) caps.push(`${formatContextWindow(ctx)} 上下文`)
            }
            return (
              <li key={i} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <ActionIcon
                    action={op.action}
                    className="w-3.5 h-3.5 shrink-0 text-content-muted"
                  />
                  <span
                    className={cn('min-w-0 truncate', satisfied ? 'text-content-muted' : 'text-content-secondary')}
                    title={describeProviderModelOp(op)}
                  >
                    {describeProviderModelOp(op)}
                  </span>
                  {satisfied && <Check className="w-3 h-3 shrink-0 text-content-muted ml-auto" />}
                  {!satisfied && blocked && (
                    <span className="ml-auto shrink-0 text-red-500">{blocked}</span>
                  )}
                </div>
                {caps.length > 0 && (
                  <div className="pl-5 flex items-center gap-1">
                    {caps.map((c) => (
                      <span
                        key={c}
                        className="rounded border border-line/60 px-1 py-[1px] text-[10px] text-content-muted"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {/* 删除第二层防护：计算题（仅 remove 流程） */}
        {phase === 'confirm' && challenge && (
          <div className="flex flex-col gap-1.5 rounded-md border border-line/60 bg-surface px-2 py-1.5">
            <p className="flex items-center gap-1 text-[11px] text-content-secondary">
              <TriangleAlert className="w-3 h-3 shrink-0 text-red-500" />
              移除操作需二次确认，请计算
              <span className="font-medium text-content-primary">
                {challenge.a} + {challenge.b} = ?
              </span>
            </p>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                inputMode="numeric"
                value={answer}
                onChange={(e) => {
                  setAnswer(e.target.value.replace(/[^\d]/g, '').slice(0, 3))
                  setAnswerWrong(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleChallengeSubmit()
                }}
                placeholder="答案"
                className="w-16 rounded-md border border-line/60 bg-surface-muted px-2 py-1 text-[11px] text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-line-strong/30"
              />
              <button
                type="button"
                onClick={handleChallengeSubmit}
                className="inline-flex items-center gap-1 rounded-md border border-red-500/40 px-3 py-1 text-xs text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                确认删除
              </button>
              <button
                type="button"
                onClick={() => {
                  setPhase('idle')
                  setChallenge(null)
                  setAnswerWrong(false)
                }}
                className="rounded-md px-2 py-1 text-xs text-content-muted hover:text-content-secondary transition-colors"
              >
                取消
              </button>
              {answerWrong && <span className="text-[11px] text-red-500">答案不正确</span>}
            </div>
          </div>
        )}

        {phase === 'error' && execError && (
          <p className="flex items-center gap-1 text-[11px] text-red-500">
            <TriangleAlert className="w-3 h-3 shrink-0" />
            {execError}
          </p>
        )}

        {phase !== 'confirm' && (
          <div className="flex items-center justify-end gap-2">
            {hasBlocked && (
              <span className="text-[10px] text-content-muted">存在不可执行项，已禁用</span>
            )}
            <button
              type="button"
              onClick={handlePrimaryClick}
              disabled={phase === 'executing' || hasBlocked || pending.length === 0}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs text-accent-foreground hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {phase === 'executing' && <Loader2 className="w-3 h-3 animate-spin" />}
              {phase === 'error' ? '重试' : primaryLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export const ProviderModelCard = memo(ProviderModelCardInner)
