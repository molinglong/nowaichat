'use client'

import { useState } from 'react'
import {
  Globe,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Sparkles,
  Loader2,
  AlertCircle,
  Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SearchItem {
  title: string
  url: string
  snippet: string
  source?: string
}

export interface SearchGroup {
  engine: 'baidu' | 'tavily' | string
  label: string
  items: SearchItem[]
}

export interface SearchStructured {
  query: string
  groups: SearchGroup[]
  errors: string[]
  totalCount: number
}

interface SearchResultsProps {
  data: SearchStructured | null
  /** AI 一句话总结, 可选 */
  summary?: string | null
  /** 总结生成中 */
  summarizing?: boolean
  /** 生成总结 */
  onSummarize?: (query: string, items: SearchItem[]) => void
}

export function SearchResults({
  data,
  summary,
  summarizing,
  onSummarize,
}: SearchResultsProps) {
  const [activeEngine, setActiveEngine] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  if (!data) return null

  // 默认选中第一个有结果的引擎
  if (activeEngine === null && data.groups.length > 0) {
    setActiveEngine(data.groups[0].engine)
  }

  const activeGroup = data.groups.find(g => g.engine === activeEngine) || data.groups[0]
  const items = activeGroup?.items || []

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedUrl(url)
      setTimeout(() => setCopiedUrl(null), 1500)
    } catch {
      /* noop */
    }
  }

  return (
    <div className="space-y-3">
      {/* 顶部摘要条: AI 提炼 */}
      <div className="rounded-xl border border-line/60 bg-gradient-to-br from-accent/5 via-surface to-surface overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line/40 bg-surface/60">
          <Sparkles className="w-3.5 h-3.5 text-accent" />
          <span className="text-xs font-medium text-accent">AI 证据提炼</span>
        </div>
        <div className="p-3 text-xs text-content-secondary leading-relaxed">
          {summarizing ? (
            <div className="flex items-center gap-2 text-content-muted">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>正在综合所有证据…</span>
            </div>
          ) : summary ? (
            <div className="whitespace-pre-wrap">{summary}</div>
          ) : data.totalCount > 0 ? (
            <button
              onClick={() => {
                const all = data.groups.flatMap(g => g.items)
                onSummarize?.(data.query, all)
              }}
              className="inline-flex items-center gap-1.5 text-accent hover:underline"
            >
              <Sparkles className="w-3 h-3" />
              让 AI 一句话提炼这些证据
            </button>
          ) : (
            <span className="text-content-muted">未获取到证据</span>
          )}
        </div>
      </div>

      {/* 错误提示 */}
      {data.errors.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-[11px] text-amber-600 dark:text-amber-400">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertCircle className="w-3 h-3" />
            <span className="font-medium">部分搜索未启用</span>
          </div>
          <ul className="space-y-0.5 pl-4 list-disc">
            {data.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 引擎 Tab */}
      {data.groups.length > 1 && (
        <div className="flex gap-1 p-1 rounded-lg bg-surface-muted border border-line/40">
          {data.groups.map(g => (
            <button
              key={g.engine}
              onClick={() => setActiveEngine(g.engine)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] font-medium transition-colors',
                activeEngine === g.engine
                  ? 'bg-surface text-accent shadow-sm'
                  : 'text-content-secondary hover:text-content-primary',
              )}
            >
              <Search className="w-3 h-3" />
              {g.label}
              <span className="text-[10px] text-content-muted">{g.items.length}</span>
            </button>
          ))}
        </div>
      )}

      {/* 结果卡片列表 */}
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="text-xs text-content-muted text-center py-6">
            该引擎未返回结果
          </div>
        ) : (
          items.map((item, idx) => {
            const id = `${activeEngine}-${idx}`
            const expanded = expandedIds.has(id)
            const isCopied = copiedUrl === item.url
            return (
              <div
                key={id}
                className="group rounded-xl border border-line/60 bg-surface hover:border-accent/40 hover:shadow-sm transition-all overflow-hidden"
              >
                <div className="p-3">
                  {/* 头部: 序号 + 来源 + 操作 */}
                  <div className="flex items-start gap-2 mb-1.5">
                    <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-md bg-accent/10 text-accent text-[10px] font-bold">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-content-primary hover:text-accent line-clamp-2 leading-snug"
                      >
                        {item.title}
                      </a>
                      {item.source && (
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-content-muted">
                          <Globe className="w-2.5 h-2.5" />
                          <span className="truncate">{item.source}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => copyUrl(item.url)}
                        className="p-1 rounded hover:bg-surface-muted text-content-muted hover:text-content-primary"
                        title="复制链接"
                      >
                        {isCopied ? (
                          <Check className="w-3 h-3 text-emerald-500" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 rounded hover:bg-surface-muted text-content-muted hover:text-content-primary"
                        title="打开"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>

                  {/* 摘要 - 默认折叠, 长文本显示 */}
                  {item.snippet && (
                    <div
                      className={cn(
                        'text-[11px] text-content-secondary leading-relaxed',
                        expanded ? '' : 'line-clamp-3',
                      )}
                    >
                      {item.snippet}
                    </div>
                  )}

                  {/* 展开/收起按钮 */}
                  {item.snippet && item.snippet.length > 100 && (
                    <button
                      onClick={() => toggleExpand(id)}
                      className="mt-1 inline-flex items-center gap-1 text-[10px] text-accent hover:underline"
                    >
                      {expanded ? (
                        <>
                          <ChevronUp className="w-3 h-3" />
                          收起
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3 h-3" />
                          展开全文
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 底部统计 */}
      <div className="flex items-center justify-between pt-1 text-[10px] text-content-muted">
        <span>
          共 {data.totalCount} 条证据
        </span>
        {items.length > 0 && (
          <button
            onClick={() => {
              // 全部展开/收起
              if (expandedIds.size > 0) setExpandedIds(new Set())
              else setExpandedIds(new Set(items.map((_, i) => `${activeEngine}-${i}`)))
            }}
            className="hover:text-accent"
          >
            {expandedIds.size > 0 ? '全部收起' : '全部展开'}
          </button>
        )}
      </div>
    </div>
  )
}