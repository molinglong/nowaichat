'use client'

/**
 * 面具工坊卡片 —— 渲染 generate_mask 工具产出的面具草稿。
 *
 * 三态（由 view.state 驱动）:
 * - 流式(input-streaming): 参数还在生成,显示骨架占位
 * - 待确认(input-available): 草稿预览(头像/名称/定位/人格指令折叠/示例折叠) + 「添加为我的面具」
 * - 已添加(本地 state 或列表中已存在同名同指令): 折叠摘要行,可展开回看草稿
 *
 * 入库走 POST /api/masks（与设置面板手动创建同端点、同 maskInputSchema 校验）,
 * 成功后 invalidate react-query 缓存,面具选择器/侧边栏立即出现新面具。
 */
import { memo, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Loader2, VenetianMask } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchJson } from '@/lib/query/fetcher'
import { queryKeys, STALE } from '@/lib/query/keys'
import { toast } from '@/lib/toast'
import { STYLE_PRESETS } from '@/lib/ai/style-presets'
import type { MaskDTO } from '@/lib/ai/mask-types'
import { toMaskDraft } from '@/lib/ai/mask-tool'
import type { ToolCallView } from './ToolCallCard'

interface GenerateMaskCardProps {
  view: ToolCallView
}

function GenerateMaskCardInner({ view }: GenerateMaskCardProps) {
  const draft = useMemo(() => toMaskDraft(view.input), [view.input])
  const isStreaming = view.state === 'input-streaming'
  const queryClient = useQueryClient()

  const [adding, setAdding] = useState(false)
  const [addedId, setAddedId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [showFewShot, setShowFewShot] = useState(false)

  // 共享面具列表缓存:同名同指令已存在则视为已添加(历史回放/刷新后按钮态仍正确)
  const { data: userMasks } = useQuery({
    queryKey: queryKeys.masks.list(),
    queryFn: () => fetchJson<MaskDTO[]>('/api/masks'),
    staleTime: STALE.masks,
  })
  const exists = useMemo(
    () =>
      !!draft &&
      (userMasks ?? []).some((m) => m.name === draft.name && m.systemPrompt === draft.systemPrompt),
    [draft, userMasks]
  )
  const added = addedId !== null || exists

  const styleLabel = useMemo(
    () => (draft?.stylePreset ? STYLE_PRESETS.find((p) => p.id === draft.stylePreset)?.label : undefined),
    [draft?.stylePreset]
  )

  async function handleAdd() {
    if (!draft || adding) return
    setAdding(true)
    try {
      const dto = await fetchJson<MaskDTO>('/api/masks', {
        method: 'POST',
        json: {
          name: draft.name,
          avatar: draft.avatar,
          description: draft.description,
          systemPrompt: draft.systemPrompt,
          fewShot: draft.fewShot.length > 0 ? draft.fewShot : undefined,
          stylePreset: draft.stylePreset,
        },
      })
      setAddedId(dto.id)
      toast.success(`已添加面具「${dto.name}」，可在面具选择器中启用`)
      await queryClient.invalidateQueries({ queryKey: queryKeys.masks.list() })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '添加面具失败')
    } finally {
      setAdding(false)
    }
  }

  // ---- 流式骨架 ----
  if (isStreaming) {
    return (
      <div className="rounded-lg border border-line/60 bg-surface-muted overflow-hidden text-xs">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-content-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span>正在设计面具…</span>
        </div>
      </div>
    )
  }

  // ---- 草稿不完整(历史数据缺字段) ----
  if (!draft) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-line/60 bg-surface-muted px-2.5 py-1.5 text-xs text-content-muted">
        <VenetianMask className="w-3.5 h-3.5 shrink-0" />
        <span>面具草稿不完整</span>
      </div>
    )
  }

  // ---- 添加后:折叠摘要行,可展开回看 ----
  if (added) {
    return (
      <div className="rounded-lg border border-line/60 bg-surface-muted overflow-hidden text-xs">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-surface-subtle transition-colors text-left"
          aria-expanded={expanded}
        >
          <Check className="w-3.5 h-3.5 shrink-0 text-content-muted" />
          <span className="text-content-secondary">
            已添加面具 {draft.avatar} {draft.name}
          </span>
          <ChevronDown
            className={cn('w-3 h-3 ml-auto shrink-0 text-content-muted transition-transform', expanded ? '' : '-rotate-90')}
          />
        </button>
        {expanded && <DraftDetail draft={draft} styleLabel={styleLabel} showFewShot={showFewShot} onToggleFewShot={() => setShowFewShot((v) => !v)} />}
      </div>
    )
  }

  // ---- 待确认:预览 + 一键添加 ----
  return (
    <div className="rounded-lg border border-line/60 bg-surface-muted overflow-hidden text-xs">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-content-secondary border-b border-line/40">
        <VenetianMask className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0 truncate">面具草稿</span>
      </div>
      <div className="px-2.5 py-2 flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <span className="text-xl leading-none shrink-0">{draft.avatar}</span>
          <div className="min-w-0">
            <p className="font-medium text-content-primary leading-tight">{draft.name}</p>
            {draft.description && (
              <p className="text-content-muted leading-tight mt-0.5">{draft.description}</p>
            )}
          </div>
          {styleLabel && (
            <span className="ml-auto shrink-0 rounded border border-line/60 px-1.5 py-0.5 text-[10px] text-content-muted">
              {styleLabel}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-content-muted hover:text-content-secondary transition-colors self-start"
        >
          <ChevronDown className={cn('w-3 h-3 transition-transform', expanded ? '' : '-rotate-90')} />
          人格指令 · {draft.systemPrompt.length} 字
        </button>
        {expanded && (
          <p className="whitespace-pre-wrap rounded-md border border-line/40 bg-surface px-2 py-1.5 leading-relaxed text-content-secondary max-h-60 overflow-y-auto">
            {draft.systemPrompt}
          </p>
        )}

        {draft.fewShot.length > 0 && (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setShowFewShot((v) => !v)}
              className="flex items-center gap-1 text-content-muted hover:text-content-secondary transition-colors self-start"
            >
              <ChevronDown className={cn('w-3 h-3 transition-transform', showFewShot ? '' : '-rotate-90')} />
              示例对话 · {draft.fewShot.length} 轮
            </button>
            {showFewShot && (
              <div className="flex flex-col gap-1">
                {draft.fewShot.map((t, i) => (
                  <div key={i} className="rounded-md border border-line/40 bg-surface px-2 py-1.5">
                    <span className="font-mono text-[10px] text-content-muted mr-1">
                      {t.role === 'user' ? '[用户]' : '[助手]'}
                    </span>
                    <span className="text-content-secondary">{t.content}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding || exists}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs text-accent-foreground hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {adding && <Loader2 className="w-3 h-3 animate-spin" />}
            {exists ? '已在我的面具中' : '添加为我的面具'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 草稿详情（已添加态展开回看，只读，无按钮） */
function DraftDetail({
  draft,
  styleLabel,
  showFewShot,
  onToggleFewShot,
}: {
  draft: NonNullable<ReturnType<typeof toMaskDraft>>
  styleLabel?: string
  showFewShot: boolean
  onToggleFewShot: () => void
}) {
  return (
    <div className="px-2.5 pb-2 pt-0.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-base leading-none">{draft.avatar}</span>
        <span className="text-content-secondary">{draft.name}</span>
        {styleLabel && (
          <span className="ml-auto rounded border border-line/60 px-1.5 py-0.5 text-[10px] text-content-muted">
            {styleLabel}
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap rounded-md border border-line/40 bg-surface px-2 py-1.5 leading-relaxed text-content-secondary max-h-60 overflow-y-auto">
        {draft.systemPrompt}
      </p>
      {draft.fewShot.length > 0 && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={onToggleFewShot}
            className="flex items-center gap-1 text-content-muted hover:text-content-secondary transition-colors self-start"
          >
            <ChevronDown className={cn('w-3 h-3 transition-transform', showFewShot ? '' : '-rotate-90')} />
            示例对话 · {draft.fewShot.length} 轮
          </button>
          {showFewShot &&
            draft.fewShot.map((t, i) => (
              <div key={i} className="rounded-md border border-line/40 bg-surface px-2 py-1.5">
                <span className="font-mono text-[10px] text-content-muted mr-1">
                  {t.role === 'user' ? '[用户]' : '[助手]'}
                </span>
                <span className="text-content-secondary">{t.content}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

export const GenerateMaskCard = memo(GenerateMaskCardInner)
