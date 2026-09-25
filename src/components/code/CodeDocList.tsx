'use client'

import { useState } from 'react'
import { Trash2, FileCode2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import type { CodeDocSummary } from './types'

interface CodeDocListProps {
  /** 当前会话的代码文档列表(数据由 CodePanel 的 useQuery 拉取传入) */
  docs: CodeDocSummary[] | undefined
  /** 数据未就位(pending)时渲染骨架屏;用 isPending 而非 isLoading 保证 SSR 与客户端首帧一致 */
  isPending: boolean
  /** 当前打开的文档 id(高亮) */
  activeId: string | null
  onSelect: (id: string) => void
  /** 文档被删除后通知面板(若删的是当前文档需要清空编辑区) */
  onDeleted: (id: string) => void
  /** 会话缓存键(删除后精确失效本会话列表);null=新对话未落库,无需失效 */
  conversationId: string | null
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

/** 字符数紧凑显示:左栏 200px 内「21034 字符」会拆行,千位以上用 k 缩写(21034→21k) */
function fmtChars(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/**
 * 代码文档列表(代码编辑器面板左栏) —— 只展示当前会话内 AI 生成的代码产物。
 * 文档由聊天中的 write_code 工具创建,无手动新建入口;删除走两段式确认。
 */
export function CodeDocList({ docs, isPending, activeId, onSelect, onDeleted, conversationId }: CodeDocListProps) {
  const queryClient = useQueryClient()
  /** 两段式删除确认:记录待确认删除的文档 id,3s 未确认自动复位 */
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  async function handleDelete(id: string) {
    if (confirmingId !== id) {
      setConfirmingId(id)
      setTimeout(() => setConfirmingId((cur) => (cur === id ? null : cur)), 3000)
      return
    }
    setConfirmingId(null)
    try {
      await fetchJson(`/api/code/docs/${id}`, { method: 'DELETE' })
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.code.list(conversationId) })
      }
      onDeleted(id)
      toast.success('文档已删除', { title: '代码编辑器' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败', { title: '代码编辑器' })
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* 栏目标题 */}
      <div className="px-3 py-2.5 border-b border-line">
        <div className="text-[11px] font-medium text-content-secondary">本对话的代码</div>
        <div className="text-[10px] text-content-muted mt-0.5">AI 在当前对话中生成的产物</div>
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
            本对话还没有代码产物
            <br />
            让 AI 写个网页/脚本试试
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
                  <FileCode2
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
                    {/* 单行元信息:language 固定不缩,后半截 truncate —— 200px 窄栏内绝不拆行 */}
                    <div className="text-[10px] text-content-muted mt-0.5 flex items-center gap-1.5 min-w-0 whitespace-nowrap">
                      <span className="font-mono text-content-secondary/80 shrink-0">{doc.language}</span>
                      <span className="truncate">· {fmtChars(doc.charCount)} 字符 · {fmtTime(doc.updatedAt)}</span>
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

