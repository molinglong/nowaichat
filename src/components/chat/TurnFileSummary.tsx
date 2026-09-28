'use client'

/**
 * 回合变更摘要条(P1) —— 聚合一条助手消息里 local_file 的文件变更
 * (create/edit/move/delete 的成功项),折叠为「N files changed」一行,展开列出每个文件,
 * 支持单文件撤销(lf_undo,有快照的才给按钮)与在编辑器 tab 中打开。
 * 参照 ZCode ConversationFileSummaryPanel:让「AI 到底对我的文件做了什么」有集中答案。
 * 仅桌面端有实义(撤销/编辑器依赖 Tauri);网页端/无变更时渲染 null。
 */
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { UIMessage } from 'ai'
import { ChevronRight, Loader2, Pencil, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat-store'
import { undoFile } from '@/lib/tauri-files'
import { getIsTauri } from '@/lib/tauri'
import { toast } from '@/lib/toast'
import {
  LOCAL_FILE_TOOL_NAME,
  isLocalFileOutput,
  toLocalFileView,
  type LocalFileAction,
} from '@/lib/ai/local-file-tool'

interface FileChange {
  toolCallId: string
  action: LocalFileAction
  path: string
  bytes: number
  undoId: string | null
}

const ACTION_BADGE: Record<string, { label: string; cls: string }> = {
  create: { label: '新建', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  edit: { label: '修改', cls: 'bg-accent-soft text-accent' },
  move: { label: '移动', cls: 'bg-accent-soft text-accent' },
  delete: { label: '删除', cls: 'bg-red-500/10 text-red-500' },
}

export function TurnFileSummary({ message }: { message: UIMessage }) {
  const [open, setOpen] = useState(false)
  const [undoBusyId, setUndoBusyId] = useState<string | null>(null)
  const openEditor = useChatStore((s) => s.openEditor)
  const qc = useQueryClient()
  const inTauri = getIsTauri()

  const changes = useMemo<FileChange[]>(() => {
    const out: FileChange[] = []
    for (const p of message.parts as Array<{
      type?: string
      state?: string
      toolCallId?: string
      input?: unknown
      output?: unknown
    }>) {
      if (p.type !== `tool-${LOCAL_FILE_TOOL_NAME}`) continue
      if (p.state !== 'output-available') continue // 只统计已落盘的
      const o = isLocalFileOutput(p.output) ? p.output : null
      if (!o || o.ok !== true) continue
      const v = toLocalFileView(p.input)
      const action = o.action ?? v.action
      if (action !== 'create' && action !== 'edit' && action !== 'move' && action !== 'delete') continue
      const path = action === 'move' ? v.toPath : v.path
      if (!path) continue
      out.push({
        toolCallId: p.toolCallId ?? '',
        action,
        path,
        bytes: typeof o.bytes === 'number' ? o.bytes : 0,
        undoId: o.undoId ?? null,
      })
    }
    return out
  }, [message])

  if (changes.length === 0) return null

  async function handleUndo(c: FileChange) {
    if (!c.undoId || undoBusyId) return
    setUndoBusyId(c.toolCallId)
    try {
      const r = await undoFile(c.undoId)
      if (r.ok) {
        qc.invalidateQueries({ queryKey: ['workspace'] })
        toast.success(`已撤销:${c.path} 恢复到操作前`, { title: '本地文件' })
      } else {
        toast.error(r.error || '撤销失败')
      }
    } finally {
      setUndoBusyId(null)
    }
  }

  return (
    <div
      className={cn(
        'mt-1 rounded-lg border border-line/60 bg-surface-muted/70 text-xs overflow-hidden',
        !inTauri && 'opacity-70'
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-content-secondary hover:text-content-primary transition-colors"
      >
        <ChevronRight
          className={cn('w-3 h-3 shrink-0 transition-transform', open && 'rotate-90')}
        />
        <span className="font-medium text-content-secondary">本回合变更</span>
        <span className="tabular-nums">
          {changes.length} 个文件
        </span>
        <span className="ml-auto text-[10px] text-content-muted">
          {inTauri ? '点击展开 · 可撤销' : '明细见文件卡片'}
        </span>
      </button>
      {open && (
        <div className="border-t border-line/60">
          {changes.map((c) => {
            const badge = ACTION_BADGE[c.action] ?? { label: c.action, cls: 'bg-surface-subtle text-content-secondary' }
            return (
              <div
                key={c.toolCallId}
                className="flex items-center gap-2 px-2.5 py-1.5 border-t border-line/40 first:border-t-0"
              >
                <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', badge.cls)}>
                  {badge.label}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-content-primary" title={c.path}>
                  {c.path}
                </span>
                {c.action !== 'delete' && inTauri && (
                  <button
                    type="button"
                    onClick={() => openEditor(c.path)}
                    title="在编辑器中打开"
                    className="shrink-0 rounded p-1 text-content-muted hover:text-content-primary hover:bg-surface-subtle transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
                {c.undoId && inTauri && (
                  <button
                    type="button"
                    onClick={() => void handleUndo(c)}
                    disabled={undoBusyId !== null}
                    title="恢复到本次操作前(快照)"
                    className="shrink-0 rounded p-1 text-content-muted hover:text-amber-600 hover:bg-amber-500/10
                      transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {undoBusyId === c.toolCallId ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Undo2 className="w-3 h-3" />
                    )}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
