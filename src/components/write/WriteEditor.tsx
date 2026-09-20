'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, PanelLeft, X } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/query/fetcher'
import { queryKeys, STALE } from '@/lib/query/keys'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { ModelSelector } from '@/components/explore/ModelSelector'
import type { ModelDefinition } from '@/lib/ai/types'
import { deAiFlavor } from '@/lib/text/deai'
import type { WriteDocFull, WriteDocSummary } from './types'

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

/** 划词状态(正文中的绝对偏移) */
interface SelectionState {
  start: number
  end: number
  text: string
}

/** 改写/去AI味预览:流式产出的新文本先在这里,确认后才替换进正文 */
interface RewritePreview {
  start: number
  end: number
  original: string
  instruction: string
  output: string
  streaming: boolean
  /** 去AI味(本地规则)时的命中统计文案 */
  deaiStats?: string
}

/** 模型列表拉取:与 TopBar 预热同构(/api/providers → 扁平模型数组) */
function useModels(): ModelDefinition[] {
  const { data } = useQuery({
    queryKey: queryKeys.providers(),
    queryFn: async () => {
      const payload = await fetchJson<
        | Array<{ id?: string; effectiveModels: ModelDefinition[] }>
        | { providers: Array<{ id?: string; effectiveModels: ModelDefinition[] }> }
      >('/api/providers')
      const list = Array.isArray(payload) ? payload : payload.providers ?? []
      return list.flatMap((p) =>
        p.effectiveModels.map((m): ModelDefinition => ({
          id: m.id,
          name: m.name,
          provider: p.id ?? '',
          contextWindow: m.contextWindow,
          supportsVision: m.supportsVision,
          supportsFiles: m.supportsFiles,
          supportsReasoning: m.supportsReasoning,
        }))
      )
    },
    staleTime: STALE.providers,
  })
  return data ?? []
}

const SAVE_LABEL: Record<SaveState, string> = {
  saved: '已保存',
  dirty: '编辑中',
  saving: '保存中…',
  error: '保存失败',
}

interface WriteEditorProps {
  docId: string
  /** 移动端打开文档列表抽屉 */
  onOpenList: () => void
}

/**
 * 写作编辑器主体:标题/字数/保存状态顶栏 + 纯文本 textarea 正文 +
 * 划词工具条与改写预览。AI 指令入口全场统一走聊天输入框(由 write_document
 * 工具驱动),画布内只保留划词快捷动作(固定语义,无需输入指令)。
 *
 * 自动保存:编辑防抖 800ms PATCH;切换文档/卸载时若有未保存改动立即补存。
 * 流式:SSE 增量 append 到正文(生成中可随时停止,保留已生成部分);
 * 改写类动作的产出走预览面板,用户确认后才替换选区。
 */
export function WriteEditor({ docId, onOpenList }: WriteEditorProps) {
  const queryClient = useQueryClient()
  const models = useModels()

  // ── 文档内容本地状态 ──
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')

  // ── 生成/预览状态 ──
  const [generating, setGenerating] = useState(false)
  const [sel, setSel] = useState<SelectionState | null>(null)
  const [preview, setPreview] = useState<RewritePreview | null>(null)

  const taRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 最新值快照:防抖保存/补存回调里读,避免闭包拿到旧值 */
  const latestRef = useRef({ docId, title, content })
  /** 已保存基线:与最新值比较判断是否真的 dirty */
  const baselineRef = useRef({ title: '', content: '' })
  const dirtyRef = useRef(false)

  const [model, setModel] = useState('')
  useEffect(() => {
    setModel(localStorage.getItem('aichatt-write-model') || '')
  }, [])
  const handleModelChange = useCallback((id: string) => {
    setModel(id)
    localStorage.setItem('aichatt-write-model', id)
  }, [])

  useEffect(() => {
    latestRef.current = { docId, title, content }
  }, [docId, title, content])

  // ── 保存 ──
  const doSave = useCallback(async () => {
    const { docId: id, title: t, content: c } = latestRef.current
    setSaveState('saving')
    try {
      const saved = await fetchJson<WriteDocSummary>(`/api/write/docs/${id}`, {
        method: 'PATCH',
        json: { title: t, content: c },
        timeoutMs: 15_000,
      })
      // 保存期间可能又有编辑(latestRef 超前本次快照):保持 dirty,防抖 effect 会再排下一次
      const stale = latestRef.current.title !== t || latestRef.current.content !== c
      baselineRef.current = { title: t, content: c }
      dirtyRef.current = stale
      setSaveState(stale ? 'dirty' : 'saved')
      // 列表缓存局部回写,免整个列表 refetch
      queryClient.setQueryData<{ docs: WriteDocSummary[] }>(queryKeys.write.list(), (old) =>
        old
          ? {
              docs: old.docs.map((d) =>
                d.id === id
                  ? { ...d, title: saved.title, charCount: saved.charCount, updatedAt: saved.updatedAt }
                  : d
              ),
            }
          : old
      )
    } catch (err) {
      console.error('[WriteEditor] save failed:', err)
      setSaveState('error')
    }
  }, [queryClient])

  // 自动保存:内容/标题变化 → 防抖 800ms
  useEffect(() => {
    if (loadState !== 'ready') return
    const changed = title !== baselineRef.current.title || content !== baselineRef.current.content
    if (!changed) return
    dirtyRef.current = true
    setSaveState('dirty')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => void doSave(), 800)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [title, content, loadState, doSave])

  // 切换文档/卸载:未保存改动立即补存(keepalive 尽量在页面关闭后也送达)
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (dirtyRef.current) {
        const { docId: id, title: t, content: c } = latestRef.current
        dirtyRef.current = false
        void fetchJson(`/api/write/docs/${id}`, {
          method: 'PATCH',
          json: { title: t, content: c },
          keepalive: true,
        }).catch(() => {})
      }
    }
  }, [docId])

  // AI 续写后同步:非 dirty 静默重载;dirty 提示(不覆盖用户未保存编辑)
  const [aiReloadTick, setAiReloadTick] = useState(0)
  useEffect(() => {
    function onDocUpdated(e: Event) {
      const detail = (e as CustomEvent<{ docId?: string }>).detail
      if (detail?.docId !== docId) return
      if (dirtyRef.current) {
        toast.info('AI 已续写这篇文档,为保留你的未保存编辑未自动刷新;保存后再次操作即可同步', { title: '写作画布' })
        return
      }
      setAiReloadTick((t) => t + 1)
    }
    window.addEventListener('aichatt:write-doc-updated', onDocUpdated)
    return () => window.removeEventListener('aichatt:write-doc-updated', onDocUpdated)
  }, [docId])

  // 加载文档
  useEffect(() => {
    const controller = new AbortController()
    setLoadState('loading')
    fetchJson<WriteDocFull>(`/api/write/docs/${docId}`, { signal: controller.signal })
      .then((doc) => {
        setTitle(doc.title)
        setContent(doc.content)
        baselineRef.current = { title: doc.title, content: doc.content }
        dirtyRef.current = false
        setSaveState('saved')
        setLoadState('ready')
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        console.error('[WriteEditor] load failed:', err)
        setLoadState('error')
      })
    return () => controller.abort()
  }, [docId, aiReloadTick])

  // 手动保存快捷键 ⌘/Ctrl+S
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirtyRef.current) void doSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doSave])

  // ── 流式生成 ──
  const runStream = useCallback(
    async (body: Record<string, unknown>, onText: (t: string) => void) => {
      const controller = new AbortController()
      abortRef.current = controller
      setGenerating(true)
      try {
        const res = await fetch('/api/write/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, model: model || undefined }),
          signal: controller.signal,
        })
        if (!res.ok || !res.body) {
          const detail = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(detail?.error || `HTTP ${res.status}`)
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const events = buffer.split('\n\n')
          buffer = events.pop() ?? ''
          for (const evt of events) {
            const line = evt.trim()
            if (!line.startsWith('data:')) continue
            let payload: { type?: string; value?: string }
            try {
              payload = JSON.parse(line.slice(5).trim())
            } catch {
              continue
            }
            if (payload.type === 'text' && payload.value) {
              onText(payload.value)
            } else if (payload.type === 'error') {
              throw new Error(payload.value || '生成失败')
            }
          }
        }
      } catch (err) {
        // 用户主动停止:保留已生成部分,不算错误
        if ((err as Error | null)?.name === 'AbortError') return
        toast.error(err instanceof Error ? err.message : '生成失败', { title: '写作画布' })
        throw err
      } finally {
        abortRef.current = null
        setGenerating(false)
      }
    },
    [model]
  )

  /** 划词 → AI 改写(流式进预览面板) */
  const openRewrite = useCallback(
    (selection: SelectionState, preset: string) => {
      setPreview({
        start: selection.start,
        end: selection.end,
        original: selection.text,
        instruction: preset,
        output: '',
        streaming: true,
      })
      setSel(null)
      void (async () => {
        try {
          await runStream(
            { docId, action: 'rewrite', instruction: preset, selection: selection.text },
            (t) => setPreview((p) => (p ? { ...p, output: p.output + t } : p))
          )
        } catch {
          /* 已 toast */
        } finally {
          setPreview((p) => (p ? { ...p, streaming: false } : p))
        }
      })()
    },
    [docId, runStream]
  )

  /** 划词 → 在选区之后插入/续写(流式追加到选区末尾,光标跟随) */
  const runInsert = useCallback(
    (selection: SelectionState, instr?: string) => {
      const end = selection.end
      setSel(null)
      let acc = ''
      void (async () => {
        try {
          await runStream(
            { docId, action: 'insert', instruction: instr, selection: selection.text },
            (t) => {
              acc += t
              setContent((prev) => prev.slice(0, end) + acc + prev.slice(end))
              // 光标跟随到插入末尾让过程可见(折叠光标不会触发划词)
              requestAnimationFrame(() => {
                const ta = taRef.current
                if (ta) ta.setSelectionRange(end + acc.length, end + acc.length)
              })
            }
          )
        } catch {
          /* 已 toast */
        }
      })()
    },
    [docId, runStream]
  )

  /** 划词 → 删除选中内容(纯前端,自动保存兜底持久化) */
  const handleDeleteSel = useCallback((selection: SelectionState) => {
    setContent((prev) =>
      selection.end <= prev.length
        ? prev.slice(0, selection.start) + prev.slice(selection.end)
        : prev
    )
    setSel(null)
  }, [])

  /** 划词 → 去AI味(本地规则,零 token,直接出预览) */
  const handleDeai = useCallback(
    (selection: SelectionState) => {
      const r = deAiFlavor(selection.text)
      if (r.hits === 0) {
        toast.success('这段没命中 AI 套话，已经很干净了', { title: '去AI味' })
        return
      }
      setPreview({
        start: selection.start,
        end: selection.end,
        original: selection.text,
        instruction: '去AI味(本地规则替换)',
        output: r.text,
        streaming: false,
        deaiStats: r.byCategory.map((c) => `${c.label}×${c.hits}`).join(' · '),
      })
      setSel(null)
    },
    []
  )

  const applyPreview = useCallback(() => {
    setPreview((p) => {
      if (!p) return null
      setContent((prev) =>
        p.end <= prev.length ? prev.slice(0, p.start) + p.output + prev.slice(p.end) : prev
      )
      return null
    })
  }, [])

  // 划词检测:textarea 原生 select 事件(桌面鼠标与移动端长按都触发)
  const handleSelect = useCallback(() => {
    if (generating || preview) return
    const ta = taRef.current
    if (!ta) return
    const { selectionStart, selectionEnd } = ta
    if (selectionEnd > selectionStart) {
      const text = ta.value.slice(selectionStart, selectionEnd)
      if (text.trim()) {
        setSel({ start: selectionStart, end: selectionEnd, text })
        return
      }
    }
    setSel(null)
  }, [generating, preview])

  // 生成时正文自动滚到底(用户手动上滚会被拉回,生成场景可接受)
  useEffect(() => {
    if (generating && taRef.current) {
      taRef.current.scrollTop = taRef.current.scrollHeight
    }
  }, [content, generating])

  // ── 加载/错误态 ──
  if (loadState === 'loading') {
    return (
      <div className="h-full flex items-center justify-center text-content-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }
  if (loadState === 'error') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-content-muted">
        <p className="text-xs">文档加载失败</p>
        <button
          onClick={() => setLoadState('loading')}
          className="text-xs text-accent hover:underline"
        >
          重试
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* 顶栏:标题 / 字数 / 保存状态 / 模型 */}
      <div className="shrink-0 flex items-center gap-2 h-11 px-2.5 md:px-3 border-b border-line">
        <button
          onClick={onOpenList}
          className="md:hidden p-1.5 -ml-1 rounded-md text-content-secondary hover:text-content-primary hover:bg-surface-subtle transition-colors"
          aria-label="文档列表"
          title="文档列表"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="未命名"
          className="flex-1 min-w-0 bg-transparent text-sm font-medium text-content-primary outline-none placeholder:text-content-muted"
        />
        <span
          className={cn(
            'shrink-0 text-[10px]',
            saveState === 'error' ? 'text-red-400' : 'text-content-muted'
          )}
        >
          {SAVE_LABEL[saveState]}
        </span>
        <span className="shrink-0 text-[10px] text-content-muted tabular-nums">
          {content.length} 字
        </span>
        <ModelSelector
          models={models}
          value={model || models[0]?.id || ''}
          onChange={handleModelChange}
          compact
        />
      </div>

      {/* 划词工具条:选中正文后浮出(定位于编辑区顶部,移动端友好) */}
      {sel && !preview && (
        <div className="shrink-0 flex items-center justify-center gap-1 py-1.5 border-b border-line bg-accent/[0.04]">
          <span className="text-[10px] text-content-muted px-1.5 hidden sm:inline">
            已选 {sel.text.length} 字
          </span>
          {[
            { label: '润色', preset: '润色这段文字:提升文采与节奏,保持原意,不要扩写篇幅' },
            { label: '扩写', preset: '扩写这段文字:补充细节与感官描写,篇幅约为原文两倍' },
            { label: '改写', preset: '改写这段文字:换一种写法表达同样的情节' },
          ].map((a) => (
            <button
              key={a.label}
              onClick={() => openRewrite(sel, a.preset)}
              disabled={generating}
              className="px-2.5 py-1 rounded-md text-xs font-medium text-content-secondary
                hover:text-content-primary hover:bg-surface-subtle disabled:opacity-50 transition-colors"
            >
              {a.label}
            </button>
          ))}
          <button
            onClick={() => runInsert(sel)}
            disabled={generating}
            className="px-2.5 py-1 rounded-md text-xs font-medium text-content-secondary
              hover:text-content-primary hover:bg-surface-subtle disabled:opacity-50 transition-colors"
            title="从选中文字之后继续写"
          >
            续写
          </button>
          <button
            onClick={() => handleDeai(sel)}
            className="px-2.5 py-1 rounded-md text-xs font-medium text-accent
              hover:bg-accent/10 disabled:opacity-50 transition-colors"
            disabled={generating}
            title="本地规则替换 AI 套话,不消耗 token"
          >
            去AI味
          </button>
          <button
            onClick={() => handleDeleteSel(sel)}
            disabled={generating}
            className="px-2.5 py-1 rounded-md text-xs font-medium text-red-400
              hover:bg-red-500/10 disabled:opacity-50 transition-colors"
            title="删除选中的文字"
          >
            删除
          </button>
          <button
            onClick={() => setSel(null)}
            className="p-1 rounded-md text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors"
            aria-label="取消选择"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 正文 */}
      <div className="flex-1 min-h-0 relative">
        <textarea
          ref={taRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onSelect={handleSelect}
          placeholder={'在这里直接写…\n\n小技巧:选中任意文字可续写/润色/扩写/改写/去AI味'}
          spellCheck={false}
          className="absolute inset-0 w-full h-full resize-none bg-transparent px-4 py-4 md:px-10 md:py-8
            text-[15px] md:text-base leading-8 md:leading-9 text-content-primary outline-none
            placeholder:text-content-muted/70 placeholder:text-sm"
        />
      </div>

      {/* 改写/去AI味预览(打开时替代底部指令框) */}
      {preview && (
        <div className="shrink-0 border-t border-line bg-surface-muted/50">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs font-medium text-content-primary truncate">
                {preview.instruction}
              </div>
              <div className="text-[10px] text-content-muted mt-0.5">
                原 {preview.original.length} 字 → 新 {preview.output.length} 字
                {preview.deaiStats ? ` · ${preview.deaiStats}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setPreview(null)}
                className="px-2.5 py-1.5 rounded-md text-xs text-content-secondary hover:text-content-primary hover:bg-surface-subtle transition-colors"
              >
                放弃
              </button>
              <button
                onClick={applyPreview}
                disabled={preview.streaming || !preview.output.trim()}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-50 transition-colors"
              >
                应用替换
              </button>
            </div>
          </div>
          <div className="px-3 pb-3 grid gap-2 md:grid-cols-2 max-h-[40vh] overflow-y-auto">
            <div className="hidden md:block">
              <div className="text-[10px] text-content-muted mb-1">原文</div>
              <div className="text-xs leading-6 text-content-secondary whitespace-pre-wrap max-h-40 overflow-y-auto p-2 rounded-lg bg-surface border border-line">
                {preview.original}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-content-muted mb-1 flex items-center gap-1">
                新文
                {preview.streaming && <Loader2 className="w-3 h-3 animate-spin text-accent" />}
              </div>
              <div className="text-xs leading-6 text-content-primary whitespace-pre-wrap max-h-40 overflow-y-auto p-2 rounded-lg bg-surface border border-line">
                {preview.output || '…'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
