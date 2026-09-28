'use client'

/**
 * 中转站/自定义模型确认卡片 —— 渲染 add_custom_model 工具产出的配置草稿。
 *
 * 三态（由 view.state 与列表缓存的终态驱动）:
 * - 流式(input-streaming): 参数还在生成,显示骨架占位
 * - 待确认(input-available): 字段可微调 + Key 输入框(就地粘贴) + 「测试并保存」
 * - 已添加(本地 state 或同 modelId 已在列表): 折叠摘要行,可展开回看
 *
 * 安全:API Key 只存在于本组件 state,提交时经请求体直达服务端
 * （先 /api/custom-models/test 草稿测试+能力探测,再 POST /api/custom-models 加密入库）,
 * 不经过模型 API、不进聊天记录。入库后 invalidate 自定义模型缓存,选择器立即可选。
 */
import { memo, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Loader2, Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchJson } from '@/lib/query/fetcher'
import { queryKeys, STALE } from '@/lib/query/keys'
import { toast } from '@/lib/toast'
import {
  CUSTOM_MODEL_PROTOCOLS,
  isCustomModelDraftSatisfied,
  toCustomModelDraft,
  type CustomModelProtocol,
} from '@/lib/ai/custom-model-tool'
import type { ToolCallView } from './ToolCallCard'

interface AddCustomModelCardProps {
  view: ToolCallView
}

/** 自定义模型列表行（/api/custom-models 返回含 ModelDefinition 与设置页字段） */
interface CustomModelRowLite {
  modelId?: string | null
}

interface DraftPayload {
  name: string
  baseURL: string
  modelId: string
  protocol: CustomModelProtocol
  contextWindow: number
}

interface DraftCapabilities {
  vision: boolean
  reasoning: boolean
}

const PROTOCOL_LABELS: Record<CustomModelProtocol, string> = {
  auto: '自动探测',
  chat: 'Chat Completions',
  responses: 'Responses API',
  anthropic: 'Anthropic',
}

const INPUT_CLASS =
  'w-full rounded-md border border-line/60 bg-surface px-2 py-1 text-xs text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-1 focus:ring-line-strong/30 focus:border-line-strong'

type OverrideKey = 'name' | 'baseURL' | 'modelId' | 'protocol' | 'contextWindow'

function AddCustomModelCardInner({ view }: AddCustomModelCardProps) {
  const draft = useMemo(() => toCustomModelDraft(view.input), [view.input])
  const queryClient = useQueryClient()

  const [overrides, setOverrides] = useState<Partial<Record<OverrideKey, string>>>({})
  const [apiKey, setApiKey] = useState('')
  const [phase, setPhase] = useState<'idle' | 'testing' | 'saving'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [savedCaps, setSavedCaps] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)

  // 共享列表缓存:同 modelId 已存在则视为已添加(历史回放/刷新后按钮态仍正确)
  const { data: rows } = useQuery({
    queryKey: queryKeys.customModels(),
    queryFn: () => fetchJson<CustomModelRowLite[]>('/api/custom-models'),
    staleTime: STALE.customModels,
  })

  const name = overrides.name ?? draft?.name ?? ''
  const baseURL = overrides.baseURL ?? draft?.baseURL ?? ''
  const modelId = overrides.modelId ?? draft?.modelId ?? ''
  const protocol = (overrides.protocol as CustomModelProtocol | undefined) ?? draft?.protocol ?? 'auto'
  const contextWindowRaw = overrides.contextWindow ?? (draft ? String(draft.contextWindow) : '')

  const exists = isCustomModelDraftSatisfied(modelId, rows ?? [])
  const added = saved || exists
  const busy = phase !== 'idle'

  function setField(key: OverrideKey, value: string) {
    setOverrides((o) => ({ ...o, [key]: value }))
  }

  function buildPayload(): DraftPayload {
    const cw = Number(contextWindowRaw)
    return {
      name: name.trim() || modelId.trim(),
      baseURL: baseURL.trim().replace(/\/+$/, ''),
      modelId: modelId.trim(),
      protocol,
      contextWindow: Number.isFinite(cw) && cw >= 1000 ? Math.floor(cw) : 32768,
    }
  }

  function validate(payload: DraftPayload): string | null {
    if (!payload.modelId) return '模型 ID 不能为空'
    if (!/^https?:\/\//i.test(payload.baseURL)) return 'Base URL 必须是 http:// 或 https:// 开头的完整端点'
    return null
  }

  /** 草稿测试 + 能力探测（Key 只随本次请求体到服务端，不入库） */
  async function testDraft(payload: DraftPayload): Promise<DraftCapabilities> {
    const data = await fetchJson<{
      ok?: boolean
      error?: string
      capabilities?: { supportsVision?: boolean; supportsReasoning?: boolean }
    }>('/api/custom-models/test', {
      method: 'POST',
      json: {
        ...payload,
        keySource: 'own',
        apiKey: apiKey.trim(),
        detectCapabilities: true,
      },
      timeoutMs: 90_000,
    })
    if (!data?.ok) throw new Error(data?.error || '连接测试失败')
    return {
      vision: !!data.capabilities?.supportsVision,
      reasoning: !!data.capabilities?.supportsReasoning,
    }
  }

  async function persist(payload: DraftPayload, caps: DraftCapabilities) {
    await fetchJson('/api/custom-models', {
      method: 'POST',
      json: {
        ...payload,
        keySource: 'own',
        apiKey: apiKey.trim(),
        supportsVision: caps.vision,
        supportsFiles: false,
        supportsReasoning: caps.reasoning,
      },
    })
    await queryClient.invalidateQueries({ queryKey: queryKeys.customModels() })
    const labels: string[] = []
    if (caps.vision) labels.push('视觉')
    if (caps.reasoning) labels.push('思考')
    setSavedCaps(labels)
    setSaved(true)
    setApiKey('')
    toast.success(`已添加自定义模型「${payload.name}」，可在模型选择器中切换使用`)
  }

  async function handleSubmit() {
    if (busy) return
    const payload = buildPayload()
    const invalid = validate(payload)
    if (invalid) {
      setError(invalid)
      return
    }
    if (!apiKey.trim()) {
      setError('请先粘贴该中转站的 API Key（只发给上方端点，不进对话记录）')
      return
    }
    setError(null)
    try {
      setPhase('testing')
      const caps = await testDraft(payload)
      setPhase('saving')
      await persist(payload, caps)
    } catch (err) {
      setError(err instanceof Error ? err.message : '测试或保存失败')
    } finally {
      setPhase('idle')
    }
  }

  /** 测试失败时的兜底：跳过测试直接入库（能力标记按未启用处理，之后可在设置里调整） */
  async function handleSaveOnly() {
    if (busy) return
    const payload = buildPayload()
    const invalid = validate(payload)
    if (invalid) {
      setError(invalid)
      return
    }
    if (!apiKey.trim()) {
      setError('请先粘贴该中转站的 API Key')
      return
    }
    setError(null)
    try {
      setPhase('saving')
      await persist(payload, { vision: false, reasoning: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setPhase('idle')
    }
  }

  // ---- 流式骨架 ----
  if (view.state === 'input-streaming') {
    return (
      <div className="rounded-lg border border-line/60 bg-surface-muted overflow-hidden text-xs">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-content-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span>正在整理中转站配置…</span>
        </div>
      </div>
    )
  }

  // ---- 草稿不完整(缺 base URL 或模型 ID) ----
  if (!draft) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-line/60 bg-surface-muted px-2.5 py-1.5 text-xs text-content-muted">
        <Server className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0">中转站配置不完整（缺少 Base URL 或模型 ID），可在 设置 → 自定义模型 手动添加</span>
      </div>
    )
  }

  // ---- 已添加:折叠摘要行,可展开回看 ----
  if (added) {
    return (
      <div className="rounded-lg border border-line/60 bg-surface-muted overflow-hidden text-xs">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-surface-subtle transition-colors text-left"
          aria-expanded={expanded}
        >
          <Check className="w-3.5 h-3.5 shrink-0 text-content-muted" />
          <span className="min-w-0 truncate text-content-secondary">
            已添加自定义模型 {name} · {modelId}
          </span>
          <ChevronDown
            className={cn('w-3 h-3 ml-auto shrink-0 text-content-muted transition-transform', expanded ? '' : '-rotate-90')}
          />
        </button>
        {expanded && (
          <div className="px-2.5 pb-2 pt-0.5 flex flex-col gap-1 border-t border-line/40">
            <p className="break-all font-mono text-[10px] text-content-muted">{baseURL}</p>
            <p className="text-content-secondary">
              协议：{PROTOCOL_LABELS[protocol]} · 上下文：{contextWindowRaw || 32768}
            </p>
            {savedCaps.length > 0 && (
              <p className="text-content-muted">已按测试结果启用：{savedCaps.join('、')}</p>
            )}
            <p className="text-content-muted">可在 设置 → 自定义模型 修改 Key、地址与能力标记</p>
          </div>
        )}
      </div>
    )
  }

  // ---- 待确认:配置表单 + Key 就地粘贴 + 测试并保存 ----
  return (
    <div className="rounded-lg border border-line/60 bg-surface-muted overflow-hidden text-xs">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-content-secondary border-b border-line/40">
        <Server className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0 truncate">中转站配置</span>
      </div>
      <div className="px-2.5 py-2 flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-content-muted">名称</span>
            <input
              className={INPUT_CLASS}
              value={name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="显示名"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-content-muted">模型 ID</span>
            <input
              className={cn(INPUT_CLASS, 'font-mono')}
              value={modelId}
              onChange={(e) => setField('modelId', e.target.value)}
              placeholder="gpt-5.6-sol"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-content-muted">Base URL</span>
          <input
            className={cn(INPUT_CLASS, 'font-mono')}
            value={baseURL}
            onChange={(e) => setField('baseURL', e.target.value)}
            placeholder="https://example.com/v1"
            spellCheck={false}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-content-muted">协议</span>
            <select
              className={cn(INPUT_CLASS, 'cursor-pointer')}
              value={protocol}
              onChange={(e) => setField('protocol', e.target.value)}
            >
              {CUSTOM_MODEL_PROTOCOLS.map((p) => (
                <option key={p} value={p}>
                  {PROTOCOL_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-content-muted">上下文窗口（token）</span>
            <input
              className={INPUT_CLASS}
              type="number"
              min={1000}
              value={contextWindowRaw}
              onChange={(e) => setField('contextWindow', e.target.value)}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-content-muted">API Key</span>
          <input
            className={cn(INPUT_CLASS, 'font-mono')}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="粘贴该中转站的 Key（sk-…）"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <p className="text-[10px] leading-relaxed text-content-muted">
          Key 只随下方操作直接发往上面的端点，不进入对话记录；请先核对域名再粘贴。
        </p>
        {error && <p className="break-words text-red-500/90">{error}</p>}
        <div className="flex items-center justify-end gap-3">
          {error && (
            <button
              type="button"
              onClick={handleSaveOnly}
              disabled={busy}
              className="text-content-muted hover:text-content-secondary transition-colors disabled:opacity-40"
            >
              跳过测试直接保存
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs text-accent-foreground hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy && <Loader2 className="w-3 h-3 animate-spin" />}
            {phase === 'testing' ? '测试连接中…' : phase === 'saving' ? '保存中…' : '测试并保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

export const AddCustomModelCard = memo(AddCustomModelCardInner)
