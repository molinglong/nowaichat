'use client'

/**
 * 删除自定义模型卡片 —— 渲染 delete_custom_model 工具产出的删除目标
 * （scope=chat 聊天中转站模型 / scope=image 生图自定义模型），
 * 用户点击确认并通过计算题校验后才真正删除（与设置面板手动操作同端点、同校验）：
 * chat → DELETE /api/custom-models/[id]；image → PATCH /api/image-settings(customModel.action=delete)。
 *
 * 状态模型（数据驱动，天然解决历史回放）：
 * - 流式(input-streaming): 骨架占位
 * - 待确认: 目标列表 + 确认按钮；有不可执行项（范围不符）则整体禁用并标注原因
 * - 已删除/目标不存在: 依据两个模型库的实时清单判断（isCustomModelDeleteSatisfied），
 *   刷新/回放后按钮态依然正确，无需持久化"已执行"标记
 *
 * 删除防护（两层，与 ProviderModelCard remove 同协议）：
 * 1. 二次确认：点击「确认删除」后展开确认区
 * 2. 计算题：1-100 内加法（如 23 + 28 = ?），答对才发删除请求
 * 防误触设计（操作者即本人），不承担防攻击职责；题目在二次确认时才生成，
 * 避免 SSR 期间 Math.random 水合不一致。
 */
import { memo, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Trash2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchJson } from '@/lib/query/fetcher'
import { queryKeys, STALE } from '@/lib/query/keys'
import { toast } from '@/lib/toast'
import {
  CUSTOM_MODEL_SCOPE_LABELS,
  describeCustomModelDeleteResult,
  describeCustomModelDeleteTarget,
  toCustomModelDeleteTargets,
  type CustomModelDeleteTarget,
} from '@/lib/ai/delete-custom-model-tool'
import type { ToolCallView } from './ToolCallCard'

/** GET /api/custom-models 行（卡片只消费其中几个字段） */
interface ChatCustomModelRow {
  dbId?: string
  modelId?: string | null
  name?: string | null
  baseURL?: string | null
}

/** GET /api/image-settings 响应（卡片只消费 customModels 段） */
interface ImageSettingsResponse {
  customModels?: Array<{
    id: string
    modelId?: string | null
    name?: string | null
    baseURL?: string | null
  }>
}

/** 1-100 内加法挑战（如 1+11 / 9+12 / 23+28），结果 12-99 */
function makeChallenge(): { a: number; b: number } {
  return {
    a: 11 + Math.floor(Math.random() * 40), // 11-50
    b: 1 + Math.floor(Math.random() * 49), // 1-49
  }
}

/** 目标在卡片里的解析状态：pending=待删除 satisfied=已不存在 blocked=范围不符不可执行 */
interface TargetEntry {
  target: CustomModelDeleteTarget
  status: 'pending' | 'satisfied' | 'blocked'
  /** blocked 原因（红字） */
  note?: string
}

interface DeleteCustomModelCardProps {
  view: ToolCallView
}

function DeleteCustomModelCardInner({ view }: DeleteCustomModelCardProps) {
  const targets = useMemo(() => toCustomModelDeleteTargets(view.input), [view.input])
  const isStreaming = view.state === 'input-streaming'
  const queryClient = useQueryClient()

  // 两个模型库的实时清单：解析目标与执行前核对共用
  const { data: chatData, isLoading: chatLoading } = useQuery({
    queryKey: queryKeys.customModels(),
    queryFn: () => fetchJson<ChatCustomModelRow[]>('/api/custom-models'),
    staleTime: STALE.customModels,
  })
  const { data: imageData, isLoading: imageLoading } = useQuery({
    queryKey: queryKeys.images.settings(),
    queryFn: () => fetchJson<ImageSettingsResponse>('/api/image-settings'),
    staleTime: STALE.imageSettings,
  })
  const isLoading = chatLoading || imageLoading

  // 按 scope 建 modelId 集合（直接进 useMemo，避免 `?? []` 每次渲染新数组导致依赖失效）
  const chatIds = useMemo(
    () => new Set((chatData ?? []).map((r) => r.modelId).filter((x): x is string => !!x)),
    [chatData]
  )
  const imageIds = useMemo(
    () =>
      new Set(
        (imageData?.customModels ?? []).map((r) => r.modelId).filter((x): x is string => !!x)
      ),
    [imageData]
  )
  const rowsByScope = useMemo(
    () => ({
      chat: new Map((chatData ?? []).map((r) => [r.modelId ?? '', r] as const)),
      image: new Map((imageData?.customModels ?? []).map((r) => [r.modelId ?? '', r] as const)),
    }),
    [chatData, imageData]
  )

  // 逐项解析：本库存在=可删；只在另一库存在=范围不符（禁用）；都不存在=已删除/目标不存在
  const entries = useMemo<TargetEntry[]>(() => {
    return targets.map((target) => {
      const own = target.scope === 'chat' ? chatIds : imageIds
      const other = target.scope === 'chat' ? imageIds : chatIds
      if (own.has(target.modelId)) return { target, status: 'pending' as const }
      if (other.has(target.modelId)) {
        const otherLabel = CUSTOM_MODEL_SCOPE_LABELS[target.scope === 'chat' ? 'image' : 'chat']
        return {
          target,
          status: 'blocked' as const,
          note: `未找到该模型（在 ${otherLabel} 库中找到同名模型，范围不符）`,
        }
      }
      return { target, status: 'satisfied' as const }
    })
  }, [targets, chatIds, imageIds])

  const pending = entries.filter((e) => e.status !== 'satisfied')
  const allSatisfied = targets.length > 0 && pending.length === 0
  const hasBlocked = pending.some((e) => e.status === 'blocked')
  const deletable = pending.filter((e) => e.status === 'pending')

  const [phase, setPhase] = useState<'idle' | 'confirm' | 'executing' | 'error'>('idle')
  const [challenge, setChallenge] = useState<{ a: number; b: number } | null>(null)
  const [answer, setAnswer] = useState('')
  const [answerWrong, setAnswerWrong] = useState(false)
  const [execError, setExecError] = useState<string | null>(null)

  /** 执行全部待删除目标（先实时拉一次清单，避免缓存过期导致删除错位/空删） */
  async function execute() {
    setPhase('executing')
    setExecError(null)
    try {
      const [freshChat, freshImage] = await Promise.all([
        fetchJson<ChatCustomModelRow[]>('/api/custom-models'),
        fetchJson<ImageSettingsResponse>('/api/image-settings'),
      ])
      for (const { target } of deletable) {
        if (target.scope === 'chat') {
          const row = freshChat.find((r) => r.modelId === target.modelId)
          if (!row?.dbId) continue // 已不存在 → 视为完成
          await fetchJson(`/api/custom-models/${encodeURIComponent(row.dbId)}`, {
            method: 'DELETE',
          })
        } else {
          const row = (freshImage.customModels ?? []).find((r) => r.modelId === target.modelId)
          if (!row?.id) continue // 已不存在 → 视为完成
          await fetchJson('/api/image-settings', {
            method: 'PATCH',
            json: { customModel: { action: 'delete', id: row.id } },
          })
        }
      }
      toast.success(deletable.map((e) => describeCustomModelDeleteResult(e.target)).join('；'))
    } catch (err) {
      setPhase('error')
      setExecError(err instanceof Error ? err.message : '执行失败')
      toast.error(err instanceof Error ? err.message : '模型删除失败')
    } finally {
      // 成败都刷新：部分失败时让本地与库对齐，重试只跑真正未完成的项（幂等安全）
      await queryClient.invalidateQueries({ queryKey: queryKeys.customModels() })
      await queryClient.invalidateQueries({ queryKey: queryKeys.images.settings() })
    }
  }

  function handlePrimaryClick() {
    if (hasBlocked || deletable.length === 0) return
    // 第一层防护：进入二次确认（展开计算题）
    setChallenge(makeChallenge())
    setAnswer('')
    setAnswerWrong(false)
    setPhase('confirm')
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
  if (isStreaming || (isLoading && targets.length > 0)) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-line/60 bg-surface-muted px-2.5 py-1.5 text-xs text-content-muted">
        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        <span>{isStreaming ? '正在准备删除操作…' : '正在核对自定义模型…'}</span>
      </div>
    )
  }

  // ---- 历史数据缺字段 ----
  if (entries.length === 0) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-line/60 bg-surface-muted px-2.5 py-1.5 text-xs text-content-muted">
        <Trash2 className="w-3.5 h-3.5 shrink-0" />
        <span>删除操作信息不完整</span>
      </div>
    )
  }

  // ---- 已删除/目标不存在（数据驱动：两库清单中已无这些模型，刷新/回放后依然成立） ----
  if (allSatisfied) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-line/60 bg-surface-muted px-2.5 py-1.5 text-xs">
        <Check className="w-3.5 h-3.5 shrink-0 text-content-muted" />
        <span
          className="min-w-0 truncate text-content-secondary"
          title={entries.map((e) => describeCustomModelDeleteResult(e.target)).join('；')}
        >
          {entries.map((e) => describeCustomModelDeleteResult(e.target)).join('；')}
        </span>
      </div>
    )
  }

  const primaryLabel =
    phase === 'executing'
      ? '执行中…'
      : deletable.length === 1
        ? '确认删除'
        : `确认删除 ${deletable.length} 项`

  return (
    <div className="rounded-lg border border-line/60 bg-surface-muted overflow-hidden text-xs">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-content-secondary border-b border-line/40">
        <Trash2 className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0 truncate">删除自定义模型</span>
        <span className="ml-auto shrink-0 text-[10px] text-content-muted">
          {pending.length} 项待确认
        </span>
      </div>

      <div className="px-2.5 py-2 flex flex-col gap-2">
        <ul className="flex flex-col gap-1.5">
          {entries.map(({ target, status, note }, i) => {
            const row = rowsByScope[target.scope].get(target.modelId)
            const baseURL = row?.baseURL ?? undefined
            return (
              <li key={i} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <Trash2 className="w-3.5 h-3.5 shrink-0 text-content-muted" />
                  <span
                    className={cn(
                      'min-w-0 truncate',
                      status === 'satisfied' ? 'text-content-muted' : 'text-content-secondary'
                    )}
                    title={describeCustomModelDeleteTarget(target)}
                  >
                    {describeCustomModelDeleteTarget(target)}
                  </span>
                  {status === 'satisfied' && (
                    <Check className="w-3 h-3 shrink-0 text-content-muted ml-auto" />
                  )}
                  {status === 'blocked' && note && (
                    <span className="ml-auto min-w-0 text-right text-red-500">{note}</span>
                  )}
                </div>
                {status !== 'satisfied' && (
                  <p className="pl-5 break-all font-mono text-[10px] text-content-muted">
                    {target.modelId}
                    {baseURL ? `（${baseURL}）` : ''}
                  </p>
                )}
              </li>
            )
          })}
        </ul>

        {/* 删除第二层防护：计算题 */}
        {phase === 'confirm' && challenge && (
          <div className="flex flex-col gap-1.5 rounded-md border border-line/60 bg-surface px-2 py-1.5">
            <p className="flex items-center gap-1 text-[11px] text-content-secondary">
              <TriangleAlert className="w-3 h-3 shrink-0 text-red-500" />
              删除操作不可撤销，请计算
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
              disabled={phase === 'executing' || hasBlocked || deletable.length === 0}
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

export const DeleteCustomModelCard = memo(DeleteCustomModelCardInner)
