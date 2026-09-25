'use client'

/**
 * 代码编辑器主体(Monaco) —— 与写作画布(WriteEditor,textarea)解耦平级。
 *
 * 数据流:CodePanel 传入 docId → GET /api/code/docs/[id] 全文 → Monaco 渲染;
 *   编辑防抖 800ms PATCH;切换/卸载补存(keepalive);Ctrl/Cmd+S 手动保存。
 *
 * AI 集成:工具栏「让 AI 改这段」取当前全文+用户指令,派发 aichatt:code-ask-ai
 *   事件,ChatPanel 监听后走聊天发送;AI 回 code_edit 工具 → onToolCall 写入
 *   store.codePendingDiff → 本组件订阅命中 docId 即切 DiffEditor 审查模式,
 *   用户「采纳」用 modified 覆盖全文并触发保存,「放弃」丢弃。
 *   (old_text/new_text 约定为全文,采纳即整篇替换,避免片段拼接复杂度)
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Check, Eye, Loader2, Minus, Plus, Sparkles, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat-store'
import {
  EDITOR_OPTIONS,
  defineThemes,
  AICHATT_LIGHT_THEME,
  AICHATT_DARK_THEME,
} from '@/lib/monaco-shared'
import type { CodeDocFull, CodeDocSummary } from './types'

/**
 * Monaco editor 实例的最小结构类型(仅用选区读取 API,不引整包)。
 * onMount 拿到的真实实例兼容此结构,用 as 断言即可。
 */
interface MonacoEditorInstance {
  getSelection(): { isEmpty(): boolean } | null
  getModel(): { getValueInRange(range: unknown): string } | null
}

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center text-xs text-content-muted">
      <span className="inline-flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        编辑器加载中…
      </span>
    </div>
  ),
})
const MonacoDiffEditor = dynamic(() => import('@monaco-editor/react').then((m) => m.DiffEditor), {
  ssr: false,
})

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

/** 可预览语言 → 工具条展示的 MIME 标识。仅 HTML:iframe srcDoc 文本/html 渲染;
 *  markdown 不在此列(预览需 HTML 渲染器,纯 iframe 看不了,不误导用户) */
const PREVIEWABLE_LANGUAGES: Partial<Record<string, string>> = {
  html: 'text/html',
}

/** 预览缩放范围(与 ChatPreviewPanel 一致) */
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2
const ZOOM_STEP = 0.25

const SAVE_LABEL: Record<SaveState, string> = {
  saved: '已保存',
  dirty: '编辑中',
  saving: '保存中…',
  error: '保存失败',
}

/** 语言下拉选项(与后端 allowlist 子集对齐) */
const LANGUAGE_OPTIONS = [
  'typescript', 'javascript', 'python', 'rust', 'go', 'java',
  'c', 'cpp', 'csharp', 'html', 'css', 'json',
  'markdown', 'bash', 'shell', 'sql', 'yaml', 'php', 'ruby', 'swift', 'kotlin', 'plaintext',
]

interface CodeEditorProps {
  docId: string
}

export function CodeEditor({ docId }: CodeEditorProps) {
  const queryClient = useQueryClient()
  const codePendingDiff = useChatStore((s) => s.codePendingDiff)
  const setCodePendingDiff = useChatStore((s) => s.setCodePendingDiff)

  // ── 文档内容本地状态 ──
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [language, setLanguage] = useState('typescript')
  const [saveState, setSaveState] = useState<SaveState>('saved')

  const editorRef = useRef<MonacoEditorInstance | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 最新值快照:防抖保存/补存/派发 AI 请求时读,避免闭包拿到旧值 */
  const latestRef = useRef({ docId, title, content, language })
  /** 已保存基线:与最新值比较判断是否真的 dirty */
  const baselineRef = useRef({ title: '', content: '', language: 'typescript' })
  const dirtyRef = useRef(false)

  // ── 内置预览(HTML/SVG):「代码 | 预览」分段切换,iframe sandbox 隔离渲染 ──
  // 视图态仅内存,切走再切回回到代码视图(编辑器是主工作区)
  const [viewMode, setViewMode] = useState<'code' | 'preview'>('code')
  const [zoom, setZoom] = useState(1)
  // 预览内容防抖跟随编辑器(400ms):打字不卡 iframe 重渲染,停手即见效果
  const [previewSrc, setPreviewSrc] = useState('')
  useEffect(() => {
    if (viewMode !== 'preview') return
    const t = setTimeout(() => setPreviewSrc(latestRef.current.content), 400)
    return () => clearTimeout(t)
  }, [content, viewMode])
  // 切进预览或换文档时:立即取当前全文,并重置缩放(不同页面长宽差异大,残留易误判渲染异常)
  useEffect(() => {
    if (viewMode === 'preview') {
      setPreviewSrc(latestRef.current.content)
      setZoom(1)
    }
  }, [viewMode, docId])
  const previewable = !!PREVIEWABLE_LANGUAGES[language]
  // 语言不再可预览(如改成 typescript)时自动弹回代码视图,避免留一块白屏 iframe
  useEffect(() => {
    if (!previewable && viewMode === 'preview') setViewMode('code')
  }, [previewable, viewMode])

  // Monaco 深浅主题跟随 html.dark(globals.css 主题类),MutationObserver 感知切换
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const root = document.documentElement
    const sync = () => setDark(root.classList.contains('dark'))
    sync()
    const ob = new MutationObserver(sync)
    ob.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => ob.disconnect()
  }, [])

  useEffect(() => {
    latestRef.current = { docId, title, content, language }
  }, [docId, title, content, language])

  // ── 保存 ──
  const doSave = useCallback(async () => {
    const { docId: id, title: t, content: c, language: l } = latestRef.current
    setSaveState('saving')
    try {
      const saved = await fetchJson<CodeDocSummary>(`/api/code/docs/${id}`, {
        method: 'PATCH',
        json: { title: t, content: c, language: l },
        timeoutMs: 15_000,
      })
      const stale =
        latestRef.current.title !== t ||
        latestRef.current.content !== c ||
        latestRef.current.language !== l
      baselineRef.current = { title: t, content: c, language: l }
      dirtyRef.current = stale
      setSaveState(stale ? 'dirty' : 'saved')
      // 局部回写本会话列表缓存(键含 conversationId,前缀匹配全命中;
      // 不用 invalidate:保留未在渲染中的会话条目,避免切换会话时闪骨架屏)
      queryClient.setQueriesData<{ docs: CodeDocSummary[] }>(
        { queryKey: [...queryKeys.all, 'code', 'list'] },
        (old) =>
          old
            ? {
                docs: old.docs.map((d) =>
                  d.id === id
                    ? {
                        ...d,
                        title: saved.title,
                        language: saved.language,
                        charCount: saved.charCount,
                        updatedAt: saved.updatedAt,
                      }
                    : d
                ),
              }
            : old
      )
    } catch (err) {
      console.error('[CodeEditor] save failed:', err)
      setSaveState('error')
    }
  }, [queryClient])

  // 自动保存:内容/标题/语言变化 → 防抖 800ms
  useEffect(() => {
    if (loadState !== 'ready') return
    const changed =
      title !== baselineRef.current.title ||
      content !== baselineRef.current.content ||
      language !== baselineRef.current.language
    if (!changed) return
    dirtyRef.current = true
    setSaveState('dirty')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => void doSave(), 800)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [title, content, language, loadState, doSave])

  // 切换文档/卸载:未保存改动立即补存(keepalive 尽量在面板关闭后也送达)
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (dirtyRef.current) {
        const { docId: id, title: t, content: c, language: l } = latestRef.current
        dirtyRef.current = false
        void fetchJson(`/api/code/docs/${id}`, {
          method: 'PATCH',
          json: { title: t, content: c, language: l },
          keepalive: true,
        }).catch(() => {})
      }
    }
  }, [docId])

  // 加载文档
  useEffect(() => {
    const controller = new AbortController()
    setLoadState('loading')
    fetchJson<CodeDocFull>(`/api/code/docs/${docId}`, { signal: controller.signal })
      .then((doc) => {
        setTitle(doc.title)
        setContent(doc.content)
        setLanguage(doc.language || 'typescript')
        baselineRef.current = {
          title: doc.title,
          content: doc.content,
          language: doc.language || 'typescript',
        }
        dirtyRef.current = false
        setSaveState('saved')
        setLoadState('ready')
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        console.error('[CodeEditor] load failed:', err)
        setLoadState('error')
      })
    return () => controller.abort()
  }, [docId])

  // 手动保存快捷键 ⌘/Ctrl+S(Diff 审查模式下不触发,避免与采纳流程冲突)
  const diffActive = !!codePendingDiff && codePendingDiff.docId === docId
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirtyRef.current && !diffActive) void doSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doSave, diffActive])

  // ── AI Diff 审查 ──
  const pending = diffActive ? codePendingDiff : null

  /** 采纳:用 modified 覆盖全文(触发自动保存),清审查态 */
  const handleAccept = useCallback(() => {
    if (!pending) return
    setContent(pending.modified)
    setCodePendingDiff(null)
    toast.success('已采纳 AI 修改并保存', { title: '代码编辑器' })
  }, [pending, setCodePendingDiff])

  /** 放弃:丢弃 modified,清审查态 */
  const handleReject = useCallback(() => {
    setCodePendingDiff(null)
    toast.info('已放弃 AI 修改', { title: '代码编辑器' })
  }, [setCodePendingDiff])

  /** 让 AI 改这段:取 Monaco 选区文本(无选区取全文),prompt 指令,派发事件给 ChatPanel */
  const handleAskAi = useCallback(() => {
    const editor = editorRef.current
    let selection = ''
    if (editor) {
      const sel = editor.getSelection()
      if (sel && !sel.isEmpty()) {
        selection = editor.getModel()?.getValueInRange(sel) ?? ''
      }
    }
    const full = latestRef.current.content
    const instruction = window.prompt('告诉 AI 怎么改这段代码（可指明选中区域要怎么处理）')
    if (instruction === null) return
    const payload = {
      docId: latestRef.current.docId,
      language: latestRef.current.language,
      code: full,
      selection: selection || '',
      instruction,
    }
    window.dispatchEvent(new CustomEvent('aichatt:code-ask-ai', { detail: payload }))
    toast.info('已把代码交给 AI,修改建议出来后在此审查', { title: '代码编辑器' })
  }, [])

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
      {/* 顶栏:标题 / 语言 / 保存状态 / 字符数 / 代码-预览切换 / 让 AI 改 */}
      <div className="shrink-0 flex items-center gap-2 h-11 px-2.5 md:px-3 border-b border-line">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="未命名"
          className="flex-1 min-w-0 bg-transparent text-sm font-medium text-content-primary outline-none placeholder:text-content-muted"
        />
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="shrink-0 bg-surface-subtle border border-line rounded-md px-1.5 py-1 text-[10px] font-mono text-content-secondary outline-none hover:text-content-primary transition-colors"
          aria-label="语言"
        >
          {LANGUAGE_OPTIONS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <span
          className={cn(
            'shrink-0 text-[10px]',
            saveState === 'error' ? 'text-red-400' : 'text-content-muted'
          )}
        >
          {SAVE_LABEL[saveState]}
        </span>
        <span className="shrink-0 text-[10px] text-content-muted tabular-nums">
          {content.length} 字符
        </span>
        {previewable && (
          <div
            role="tablist"
            aria-label="代码/预览视图切换"
            className="shrink-0 flex items-center p-0.5 rounded-md bg-surface-subtle border border-line"
          >
            <button
              role="tab"
              aria-selected={viewMode === 'code'}
              onClick={() => setViewMode('code')}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                viewMode === 'code'
                  ? 'bg-surface text-content-primary shadow-sm'
                  : 'text-content-secondary hover:text-content-primary'
              )}
            >
              代码
            </button>
            <button
              role="tab"
              aria-selected={viewMode === 'preview'}
              onClick={() => setViewMode('preview')}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                viewMode === 'preview'
                  ? 'bg-surface text-content-primary shadow-sm'
                  : 'text-content-secondary hover:text-content-primary'
              )}
            >
              <Eye className="w-3 h-3" />
              预览
            </button>
          </div>
        )}
      </div>

      {/* Diff 审查工具条:AI 修改待采纳时浮出 */}
      {pending && (
        <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 border-b border-line bg-accent/[0.06]">
          <div className="min-w-0">
            <div className="text-xs font-medium text-content-primary truncate">AI 修改待审查</div>
            <div className="text-[10px] text-content-muted mt-0.5">
              左:原文 · 右:AI 版本 · 字符 {pending.original.length} → {pending.modified.length}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleReject}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-content-secondary
                hover:text-content-primary hover:bg-surface-subtle transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              放弃
            </button>
            <button
              onClick={handleAccept}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium
                bg-accent text-accent-foreground hover:bg-accent/90 transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              采纳
            </button>
          </div>
        </div>
      )}

      {/* 编辑/预览区:Diff 审查优先于预览(审查是代码工作流);预览模式用 sandbox iframe */}
      <div className="flex-1 min-h-0 relative">
        {pending ? (
          <MonacoDiffEditor
            key={`diff:${docId}`}
            language={language}
            theme={dark ? AICHATT_DARK_THEME : AICHATT_LIGHT_THEME}
            beforeMount={(monaco) => defineThemes(monaco)}
            original={pending.original}
            modified={pending.modified}
            options={{ ...EDITOR_OPTIONS, readOnly: true, renderSideBySide: true }}
          />
        ) : viewMode === 'preview' && previewable ? (
          <div className="absolute inset-0 flex flex-col">
            {/* 预览工具条:缩放(与 ChatPreviewPanel 同规格) */}
            <div className="shrink-0 flex items-center gap-1.5 h-8 px-3 border-b border-line bg-surface-muted/40">
              <span className="text-[10px] text-content-muted font-mono select-none">
                {PREVIEWABLE_LANGUAGES[language]} · 沙箱隔离 · 编辑实时同步
              </span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
                disabled={zoom <= ZOOM_MIN}
                className="flex items-center justify-center w-6 h-6 rounded-full bg-surface border border-line-strong text-content-secondary hover:bg-surface-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
                aria-label="缩小"
              >
                <Minus className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="text-[10px] text-content-secondary font-mono min-w-[3rem] text-center hover:text-content-primary transition-colors"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
                disabled={zoom >= ZOOM_MAX}
                className="flex items-center justify-center w-6 h-6 rounded-full bg-surface border border-line-strong text-content-secondary hover:bg-surface-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
                aria-label="放大"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
            {/* srcDoc 挂载(弃 data: URI:Chrome ~2MB 上限会静默白屏);
                sandbox 不给 allow-same-origin → opaque origin,页面脚本摸不到父页面。
                SVG 类产物若有也必须走同一 iframe:内联渲染(dangerouslySetInnerHTML)
                会执行 SVG 里的 <script>,是 XSS 口子 */}
            <div className="flex-1 min-h-0 overflow-auto">
              <iframe
                title="HTML 预览"
                srcDoc={previewSrc}
                sandbox="allow-scripts allow-forms allow-popups"
                className="w-full h-full bg-white border-0 origin-top-left"
                style={{ transform: `scale(${zoom})`, width: `${100 / zoom}%`, height: `${100 / zoom}%` }}
              />
            </div>
          </div>
        ) : (
          <MonacoEditor
            key={`edit:${docId}`}
            language={language}
            value={content}
            theme={dark ? AICHATT_DARK_THEME : AICHATT_LIGHT_THEME}
            beforeMount={(monaco) => defineThemes(monaco)}
            onMount={(editor) => {
              editorRef.current = editor as MonacoEditorInstance
            }}
            onChange={(v) => setContent(v ?? '')}
            options={EDITOR_OPTIONS}
          />
        )}
      </div>

      {/* 底部状态栏:语言 + 让 AI 改这段(非 Diff 模式) */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-1.5 border-t border-line font-mono text-[10px] text-content-muted">
        <span>{language}</span>
        <span>UTF-8</span>
        <div className="flex-1" />
        {!pending && (
          <button
            onClick={handleAskAi}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-accent
              hover:bg-accent/10 transition-colors"
            title="把当前代码(或选中片段)交给 AI 修改,修改建议出来后在此审查采纳"
          >
            <Sparkles className="w-3 h-3" />
            让 AI 改这段
          </button>
        )}
      </div>
    </div>
  )
}
