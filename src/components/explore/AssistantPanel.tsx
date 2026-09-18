'use client'

import { useState } from 'react'
import { Search, Brain, Loader2, Globe, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SearchResults, type SearchStructured } from './SearchResults'

interface AssistantPanelProps {
  topic?: string
  userMessage?: string
  opponentMessage?: string
  onSearch: (query: string) => void
  onAnalyze: (content: string) => void
  searching: boolean
  analysis?: string | null
  evidenceResults?: string | null
  evidenceStructured?: SearchStructured | null
  /** 自定义外层 className(移动端用来切换"全宽 / 限宽"布局) */
  className?: string
}

type Tab = 'search' | 'logic' | 'polish'

export function AssistantPanel({
  topic,
  userMessage,
  opponentMessage,
  onSearch,
  onAnalyze,
  searching,
  analysis,
  evidenceResults,
  evidenceStructured,
  className,
}: AssistantPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSummary, setSearchSummary] = useState<string | null>(null)
  const [summarizing, setSummarizing] = useState(false)

  const handleSearch = () => {
    if (!searchQuery.trim()) return
    setSearchSummary(null)
    onSearch(searchQuery)
  }

  const handleLogicAnalyze = () => {
    if (!userMessage) return
    onAnalyze(userMessage)
  }

  const handleSummarize = async (query: string) => {
    if (!evidenceStructured) return
    const allItems = evidenceStructured.groups.flatMap(g => g.items)
    if (allItems.length === 0) return
    setSummarizing(true)
    setSearchSummary(null)
    try {
      const res = await fetch('/api/explore/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'evidence-suggestion',
          content: `请基于以下搜索证据, 用 2-3 句话总结这些证据对"${query}"这个议题的整体倾向（是支持、反对、还是混合证据）。不要列条目,直接给结论。`,
          topic: query,
          model: localStorage.getItem('aichatt_assistant_model') || 'gpt-4o',
          contextSnippets: allItems.map(i => ({ title: i.title, snippet: i.snippet, source: i.source })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '提炼失败')
      setSearchSummary(data.analysis)
    } catch (err) {
      setSearchSummary('提炼失败: ' + (err instanceof Error ? err.message : '请重试'))
    } finally {
      setSummarizing(false)
    }
  }

  const suggestedQueries = topic ? [
    `${topic} 研究数据`,
    `${topic} 最新进展`,
    `${topic} 正反方观点`,
  ] : []

  return (
    <div className={cn(
      // 移动端:全宽,顶部边框;桌面端:固定 320px,左侧边框
      'w-full md:w-80 shrink-0 md:shrink-0 border-t md:border-t-0 md:border-l border-line/60 bg-surface-muted/30 flex flex-col overflow-hidden',
      'min-h-[280px] md:min-h-0',
      className,
    )}>
      {/* 标签切换 */}
      <div className="shrink-0 flex border-b border-line/60">
        <TabButton
          active={activeTab === 'search'}
          onClick={() => setActiveTab('search')}
          icon={<Globe className="w-3 h-3" />}
          label="搜索论据"
        />
        <TabButton
          active={activeTab === 'logic'}
          onClick={() => setActiveTab('logic')}
          icon={<Brain className="w-3 h-3" />}
          label="逻辑审查"
        />
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'search' && (
          <div className="space-y-3">
            <div className="text-xs text-content-secondary">
              联网搜索论据，支持百度 + Tavily 双引擎
            </div>

            {/* 搜索输入 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="输入搜索关键词..."
                className="flex-1 px-3 py-2 rounded-lg bg-surface border border-line/60 text-xs placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
              <button
                onClick={handleSearch}
                disabled={!searchQuery.trim() || searching}
                className={cn(
                  'px-3 py-2 rounded-lg text-xs font-medium transition-colors',
                  'bg-accent text-accent-foreground',
                  'hover:bg-accent-hover',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {searching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              </button>
            </div>

            {/* 快捷搜索 */}
            <div className="space-y-1.5">
              <div className="text-[10px] text-content-muted font-medium">快捷搜索</div>
              {suggestedQueries.map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setSearchQuery(q)
                    onSearch(q)
                  }}
                  disabled={searching}
                  className="w-full text-left px-2 py-1.5 rounded text-xs text-content-secondary hover:text-accent hover:bg-accent/5 transition-colors disabled:opacity-50 truncate"
                >
                  {q}
                </button>
              ))}
            </div>

            {/* 搜索结果 */}
            {searching && (
              <div className="flex items-center gap-2 py-4 text-xs text-content-muted">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>搜索中（百度 + Tavily）...</span>
              </div>
            )}

            {!searching && evidenceStructured && (
              <SearchResults
                data={evidenceStructured}
                summary={searchSummary}
                summarizing={summarizing}
                onSummarize={handleSummarize}
              />
            )}

            {!searching && !evidenceStructured && evidenceResults && (
              // 兜底: 如果后端没返回结构化数据, 显示原文
              <div className="p-3 rounded-lg bg-surface border border-line/60">
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="w-3 h-3 text-emerald-500" />
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">搜索结果</span>
                </div>
                <div className="text-xs text-content-secondary whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                  {evidenceResults}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'logic' && (
          <div className="space-y-3">
            <div className="text-xs text-content-secondary">
              审查你的论点逻辑，找出漏洞并提供改进建议
            </div>

            {/* 当前论点预览 */}
            {userMessage && (
              <div className="p-2 rounded-lg bg-surface border border-line/60">
                <div className="text-[10px] text-content-muted mb-1">当前论点</div>
                <div className="text-xs text-content-secondary line-clamp-4">
                  {userMessage}
                </div>
              </div>
            )}

            {/* 审查按钮 */}
            <button
              onClick={handleLogicAnalyze}
              disabled={!userMessage || searching}
              className={cn(
                'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium transition-colors',
                'bg-accent text-accent-foreground',
                'hover:bg-accent-hover',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {searching ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  审查中...
                </>
              ) : (
                <>
                  <Brain className="w-3 h-3" />
                  审查论点逻辑
                </>
              )}
            </button>

            {/* 审查结果 */}
            {analysis && (
              <div className="p-3 rounded-lg bg-surface border border-line/60">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-3 h-3 text-accent" />
                  <span className="text-xs font-medium text-accent">逻辑审查结果</span>
                </div>
                <div className="text-xs text-content-secondary whitespace-pre-wrap">
                  {analysis}
                </div>
              </div>
            )}

            {/* 审查维度说明 */}
            <div className="text-[10px] text-content-muted space-y-1">
              <div className="font-medium text-content-secondary">审查维度：</div>
              <div>· 逻辑谬误（滑坡、人身攻击等）</div>
              <div>· 证据充分性</div>
              <div>· 论点一致性</div>
              <div>· 可预见的反驳点</div>
            </div>
          </div>
        )}
      </div>

      {/* 底部说明 */}
      <div className="shrink-0 px-3 py-2 border-t border-line/60 text-[10px] text-content-muted">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>联网搜索已启用</span>
        </div>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors',
        active
          ? 'text-accent border-b-2 border-accent bg-accent/5'
          : 'text-content-secondary hover:text-content-primary hover:bg-surface-muted'
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
