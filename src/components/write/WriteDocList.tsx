'use client'

import { useState } from 'react'
import { Plus, Trash2, FileText, Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import type { WriteDocSummary } from './types'

interface WriteDocListProps {
  docs: WriteDocSummary[] | undefined
  /** 数据未就位(pending)时渲染骨架屏;用 isPending 而非 isLoading 保证 SSR 与客户端首帧一致(见 lib/query/client.ts) */
  isPending: boolean
  /** 当前打开的文档 id(高亮) */
  activeId: string | null
  onSelect: (id: string) => void
  /** 文档被删除后通知页面(若删的是当前文档需要清空编辑区) */
  onDeleted: (id: string) => void
}

/** 列表时间显示:今天显示 HH:mm,更早显示 M/D */
function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/**
 * 写作文档列表(/write 左栏,移动端抽屉复用本组件)。
 * 列表数据由页面持有(空态/自动选中要用),这里只负责渲染与增删。
 */
export function WriteDocList({ docs, isPending, activeId, onSelect, onDeleted }: WriteDocListProps) {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  /** 两段式删除确认:记录待确认删除的文档 id,3s 未确认自动复位 */
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  async function handleCreate() {
    if (creating) return
    setCreating(true)
    try {
      const doc = await fetchJson<WriteDocSummary>('/api/write/docs', {
        method: 'POST',
        json: { title: '未命名' },
      })
      queryClient.invalidateQueries({ queryKey: queryKeys.write.list() })
      onSelect(doc.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '新建失败', { title: '写作画布' })
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    if (confirmingId !== id) {
      setConfirmingId(id)
      setTimeout(() => setConfirmingId((cur) => (cur === id ? null : cur)), 3000)
      return
    }
    setConfirmingId(null)
    try {
      await fetchJson(`/api/write/docs/${id}`, { method: 'DELETE' })
      queryClient.invalidateQueries({ queryKey: queryKeys.write.list() })
      onDeleted(id)
      toast.success('文档已删除', { title: '写作画布' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败', { title: '写作画布' })
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* 新建按钮 */}
      <div className="p-2.5 border-b border-line">
        <button
          onClick={handleCreate}
          disabled={creating}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium
            bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-60 transition-colors"
        >
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          新建文档
        </button>
      </div>

      {/* 文档列表 */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {isPending ? (
          <div className="p-4 space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-surface-muted animate-pulse" />
            ))}
          </div>
        ) : !docs || docs.length === 0 ? (
          <div className="p-6 text-center text-xs text-content-muted leading-relaxed">
            还没有文档
            <br />
            点上方「新建文档」开始写作
          </div>
        ) : (
          <ul className="p-2 space-y-0.5">
            {docs.map((doc) => (
              <li key={doc.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(doc.id)}
                  onKeyDown={(e) => e.key === 'Enter' && onSelect(doc.id)}
                  className={cn(
                    'group w-full flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors',
                    doc.id === activeId ? 'bg-surface-muted' : 'hover:bg-surface-subtle'
                  )}
                >
                  <FileText
                    className={cn(
                      'w-3.5 h-3.5 shrink-0',
                      doc.id === activeId ? 'text-accent' : 'text-content-muted'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        'text-xs truncate',
                        doc.id === activeId ? 'text-content-primary font-medium' : 'text-content-primary/90'
                      )}
                    >
                      {doc.title}
                    </div>
                    <div className="text-[10px] text-content-muted mt-0.5">
                      {doc.charCount} 字 · {fmtTime(doc.updatedAt)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(doc.id)
                    }}
                    className={cn(
                      'shrink-0 p-1 rounded transition-all',
                      confirmingId === doc.id
                        ? 'text-red-400 opacity-100'
                        : 'text-content-muted opacity-0 group-hover:opacity-100 hover:text-red-400 focus:opacity-100',
                      doc.id === activeId && 'opacity-60'
                    )}
                    aria-label={confirmingId === doc.id ? '再次点击确认删除' : '删除文档'}
                    title={confirmingId === doc.id ? '再次点击确认删除' : '删除文档'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

