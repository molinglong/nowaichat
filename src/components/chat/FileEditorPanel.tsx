'use client'

/**
 * 本地文件编辑器面板 —— Monaco(VSCode 内核)右侧滑出,与写作画布(WriteDocPanel)同款交互。
 *
 * 数据流:LocalFileCard「在编辑器中打开」→ chat-store.openEditor(path)
 *   → lf_read_full_file(独立 5MB 通道,与模型的 64KB read 分离,给人看不给模型)
 *   → Monaco 渲染;保存走 lf_write_file(自动生成撤销快照),Ctrl/Cmd+S 同效。
 *
 * 双模式:编辑(可改可存) / Diff 审查(只读,左侧磁盘现状 vs 右侧编辑缓冲)。
 * 关闭时若有未保存修改,confirm 确认后丢弃——磁盘内容不受影响,快照链路不涉及。
 * Monaco 资源经 loader 指向同源 /monaco/vs(public/,随应用部署,不依赖 CDN),
 * 仅桌面端有入口;组件 dynamic + ssr:false,Web 端 bundle 零增量。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { FileCode2, Loader2, Undo2, X } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'
import { readFullFile, undoFile, writeFile, getWorkspaceDir } from '@/lib/tauri-files'
import { getIsTauri } from '@/lib/tauri'
import { toast } from '@/lib/toast'

/** Monaco 共享配置(lang 映射/选项/主题/资源路径)从 lib 引入,与代码编辑器共用 */
import {
  langFromPath,
  EDITOR_OPTIONS,
  defineThemes,
  AICHATT_LIGHT_THEME,
  AICHATT_DARK_THEME,
} from '@/lib/monaco-shared'

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

/** 与 transition-duration 保持一致;关闭后延迟卸载编辑器(保住滑出动画) */
const CLOSE_ANIM_MS = 300

/** 读取结果:ready 才挂 Monaco;error 展示原因(二进制/过大/未授权等) */
type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; disk: string; absPath: string; bytes: number }
  | { kind: 'error'; message: string }

export function FileEditorPanel() {
  const editorFile = useChatStore((s) => s.editorFile)
  const closeEditor = useChatStore((s) => s.closeEditor)
  const open = editorFile !== null

  // 关闭动画播完再真正卸载编辑器(与 WriteDocPanel 同款)
  const [renderFile, setRenderFile] = useState<{ path: string; diff: boolean } | null>(null)
  useEffect(() => {
    if (editorFile) {
      setRenderFile(editorFile)
      return
    }
    const t = setTimeout(() => setRenderFile(null), CLOSE_ANIM_MS)
    return () => clearTimeout(t)
  }, [editorFile])

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [value, setValue] = useState('')
  const [dirty, setDirty] = useState(false)
  const [mode, setMode] = useState<'edit' | 'diff'>('edit')
  const [saving, setSaving] = useState(false)
  const [undoId, setUndoId] = useState<string | null>(null)
  const [undoBusy, setUndoBusy] = useState(false)
  // 跟踪当前加载的 path,避免 editorFile 引用变化(同 path 重复 open)触发重读
  const loadedPathRef = useRef<string | null>(null)
  // Monaco 深浅主题跟随 html.dark(globals.css 的主题类),MutationObserver 感知切换
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const root = document.documentElement
    const sync = () => setDark(root.classList.contains('dark'))
    sync()
    const ob = new MutationObserver(sync)
    ob.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => ob.disconnect()
  }, [])

  // 加载文件:open 且 path 变化时读盘;同 path 的 diff 标志变化只切模式不重读
  useEffect(() => {
    if (!editorFile) return
    if (loadedPathRef.current === editorFile.path) return
    loadedPathRef.current = editorFile.path
    setMode(editorFile.diff ? 'diff' : 'edit')
    setLoad({ kind: 'loading' })
    setDirty(false)
    setUndoId(null)
    setValue('')
    let cancelled = false
    void (async () => {
      const r = await readFullFile(editorFile.path)
      if (cancelled) return
      if (!r.ok || typeof r.content !== 'string') {
        setLoad({ kind: 'error', message: r.error || '读取失败' })
        return
      }
      setLoad({
        kind: 'ready',
        disk: r.content,
        absPath: r.absPath ?? editorFile.path,
        bytes: r.bytes ?? 0,
      })
      setValue(r.content)
    })()
    return () => {
      cancelled = true
    }
  }, [editorFile])

  // 模式初始值跟随打开来源;同文件重复打开(如 diff=true)也同步切换
  useEffect(() => {
    if (editorFile && loadedPathRef.current === editorFile.path) {
      setMode(editorFile.diff ? 'diff' : 'edit')
    }
  }, [editorFile])

  const requestClose = useCallback(() => {
    if (dirty && !window.confirm('有未保存的修改,关闭后将丢失。确定关闭?')) return
    setDirty(false)
    closeEditor()
  }, [dirty, closeEditor])

  // ESC 关闭(走同一确认);Ctrl/Cmd+S 保存
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        requestClose()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, requestClose])

  // 保存:整文件覆盖写入(lf_write_file 自动快照);成功后磁盘内容同步,diff 审查视角跟随
  const save = useCallback(async () => {
    if (!editorFile || saving) return
    if (load.kind !== 'ready') return
    setSaving(true)
    try {
      const w = await writeFile(editorFile.path, value)
      if (w.ok) {
        setDirty(false)
        setUndoId(w.undoId ?? null)
        setLoad({ ...load, disk: value })
        toast.success(`已保存 ${editorFile.path}`, { title: '快照已生成,可撤销' })
      } else {
        toast.error(w.error || '保存失败')
      }
    } finally {
      setSaving(false)
    }
  }, [editorFile, saving, load, value])
  const saveRef = useRef(save)
  saveRef.current = save

  // 撤销:恢复到上次写盘前内容,随后重读磁盘刷新编辑缓冲
  const handleUndo = useCallback(async () => {
    if (!undoId || undoBusy) return
    setUndoBusy(true)
    try {
      const r = await undoFile(undoId)
      if (r.ok) {
        setUndoId(null)
        const path = editorFile?.path
        if (path) {
          const rr = await readFullFile(path)
          if (rr.ok && typeof rr.content === 'string') {
            setLoad({ kind: 'ready', disk: rr.content, absPath: rr.absPath ?? path, bytes: rr.bytes ?? 0 })
            setValue(rr.content)
          }
        }
        setDirty(false)
        toast.success('已撤销,文件已恢复到上次保存前')
      } else {
        toast.error(r.error || '撤销失败')
      }
    } finally {
      setUndoBusy(false)
    }
  }, [undoId, undoBusy, editorFile])

  const workspace = useWorkspaceDir(open)
  const lang = renderFile ? langFromPath(renderFile.path) : 'plaintext'
  const lines = value ? value.split('\n').length : 0
  const canUndo = !!undoId && !dirty

  return (
    <aside
      aria-hidden={!open}
      className={`fixed inset-y-0 right-0 z-[80] w-full md:w-[min(46vw,720px)] flex flex-col
        bg-surface border-l border-line shadow-2xl
        transition-transform duration-300 ease-out
        ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}`}
    >
      {/* 面板头:文件标签 + 撤销/保存/关闭 */}
      <div className="shrink-0 flex items-center gap-2 h-12 px-3 border-b border-line">
        <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
          <FileCode2 className="w-3.5 h-3.5 text-accent" />
        </div>
        <div className="min-w-0 flex items-center gap-1.5">
          <span className="font-mono text-xs text-content-primary truncate">
            {renderFile?.path ?? ''}
          </span>
          <span
            className={`w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 transition-opacity ${dirty ? 'opacity-100' : 'opacity-0'}`}
            title="未保存修改"
          />
        </div>
        <div className="flex-1" />
        {open && (
          <>
            <button
              type="button"
              onClick={() => void handleUndo()}
              disabled={!canUndo || undoBusy}
              title="恢复到上次保存前的内容"
              className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-content-secondary
                hover:text-content-primary hover:bg-surface-subtle transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {undoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">撤销</span>
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || load.kind !== 'ready'}
              title="保存到工作区(Ctrl+S)"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium
                bg-accent text-accent-foreground hover:bg-accent-hover transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              保存
            </button>
          </>
        )}
        <button
          type="button"
          onClick={requestClose}
          aria-label="关闭编辑器"
          className="p-1.5 rounded-md text-content-secondary hover:text-content-primary
            hover:bg-surface-subtle transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 工具行:编辑/Diff 审查切换 + 工作区根 */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2">
        <div className="inline-flex gap-0.5 rounded-lg border border-line bg-surface-muted p-0.5">
          {(['edit', 'diff'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 rounded-md text-[11px] transition-colors ${
                mode === m
                  ? 'bg-surface text-content-primary shadow-sm'
                  : 'text-content-secondary hover:text-content-primary'
              }`}
            >
              {m === 'edit' ? '编辑' : 'Diff 审查'}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {workspace && (
          <span className="font-mono text-[10px] text-content-muted truncate max-w-[40%]">{workspace}</span>
        )}
      </div>

      {/* 编辑器区 */}
      <div className="flex-1 min-h-0 px-3 pb-3">
        <div className="relative h-full rounded-lg border border-line overflow-hidden bg-surface">
          {load.kind === 'error' && (
            <div className="absolute inset-0 grid place-items-center px-6 text-center">
              <div className="text-xs text-content-muted leading-relaxed">{load.message}</div>
            </div>
          )}
          {load.kind === 'loading' && (
            <div className="absolute inset-0 grid place-items-center text-xs text-content-muted">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                读取文件中…
              </span>
            </div>
          )}
          {renderFile && load.kind === 'ready' && (
            <>
              {mode === 'edit' ? (
                <MonacoEditor
                  key={`edit:${renderFile.path}`}
                  language={lang}
                  value={value}
                  theme={dark ? AICHATT_DARK_THEME : AICHATT_LIGHT_THEME}
                  beforeMount={(monaco) => defineThemes(monaco)}
                  onChange={(v) => {
                    setValue(v ?? '')
                    setDirty((v ?? '') !== load.disk)
                  }}
                  options={EDITOR_OPTIONS}
                />
              ) : (
                <MonacoDiffEditor
                  key={`diff:${renderFile.path}`}
                  language={lang}
                  theme={dark ? AICHATT_DARK_THEME : AICHATT_LIGHT_THEME}
                  beforeMount={(monaco) => defineThemes(monaco)}
                  original={load.disk}
                  modified={value}
                  options={{ ...EDITOR_OPTIONS, readOnly: true, renderSideBySide: true }}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* 状态栏 */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-1.5 border-t border-line font-mono text-[10px] text-content-muted">
        <span>{lang}</span>
        <span>Ln {lines}</span>
        <span className={dirty ? 'text-amber-500' : 'text-emerald-600 dark:text-emerald-400'}>
          {dirty ? '未保存修改' : '已保存'}
        </span>
        <div className="flex-1" />
        <span>UTF-8</span>
      </div>
    </aside>
  )
}

/** 读当前授权工作区根(仅面板展开时轮询一次);未授权/网页端为 null */
function useWorkspaceDir(enabled: boolean): string | null {
  const [dir, setDir] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled || !getIsTauri()) return
    let cancelled = false
    void getWorkspaceDir().then((d) => {
      if (!cancelled) setDir(d)
    })
    return () => {
      cancelled = true
    }
  }, [enabled])
  return dir
}
