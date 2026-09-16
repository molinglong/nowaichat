'use client'

import { useState, useEffect } from 'react'
import { ArrowLeft, Loader2, CheckCircle, XCircle, AlertTriangle, HelpCircle, Sparkles, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Topic {
  id: string
  title: string
  description: string
  proLabel: string
  conLabel: string
}

interface Message {
  id: string
  content: string
  timestamp: Date
}

interface TruthSummaryProps {
  topic: Topic
  userMessages: Message[]
  opponentMessages: Message[]
  onNewTopic: () => void
  onBack: () => void
}

interface SummaryResult {
  factConsensus: {
    text: string
    source?: string
  }[]
  valueDivergence: {
    dimension: string
    proCost: string
    conCost: string
  }[]
  factsDisputed: {
    claim: string
    proView: string
    conView: string
    reason: string
  }[]
  reflection: string
}

export function TruthSummary({
  topic,
  userMessages,
  opponentMessages,
  onNewTopic,
  onBack,
}: TruthSummaryProps) {
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<SummaryResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    generateSummary()
  }, [])

  const generateSummary = async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/explore/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.title,
          userMessages: userMessages.map(m => m.content),
          opponentMessages: opponentMessages.map(m => m.content),
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || `请求失败 (${res.status})`)
      }

      setResult(data.summary)
    } catch (err) {
      console.error('Failed to generate summary:', err)
      setError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg hover:bg-surface-muted transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-content-secondary" />
          </button>
          <div>
            <h1 className="text-xl font-bold">真相摘要</h1>
            <p className="text-sm text-content-secondary">{topic.title}</p>
          </div>
        </div>
        <button
          onClick={onNewTopic}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-accent-foreground hover:bg-accent-hover transition-colors"
        >
          新辩题
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16 text-content-muted">
          <Loader2 className="w-8 h-8 animate-spin mb-3" />
          <p className="text-sm">正在生成真相摘要...</p>
          <p className="text-xs mt-1">区分事实共识与价值分歧</p>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-content-muted">
          <AlertTriangle className="w-8 h-8 text-amber-500 mb-3" />
          <p className="text-sm text-red-500">{error}</p>
          <button
            onClick={generateSummary}
            className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-surface-muted hover:bg-surface-subtle border border-line/60 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            重试
          </button>
        </div>
      )}

      {/* Result */}
      {result && !loading && (
        <div className="space-y-6">
          {/* 事实共识 */}
          {result.factConsensus.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                </div>
                <h2 className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">事实共识</h2>
              </div>
              <div className="pl-10 space-y-2">
                {result.factConsensus.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20"
                  >
                    <div className="text-sm text-content-primary">{item.text}</div>
                    {item.source && (
                      <div className="mt-1 text-[11px] text-content-muted">
                        来源：{item.source}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 事实分歧 */}
          {result.factsDisputed.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <HelpCircle className="w-4 h-4 text-amber-500" />
                </div>
                <h2 className="text-lg font-semibold text-amber-600 dark:text-amber-400">事实分歧</h2>
              </div>
              <div className="pl-10 space-y-3">
                {result.factsDisputed.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20"
                  >
                    <div className="text-sm font-medium text-content-primary mb-2">
                      "{item.claim}"
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="p-2 rounded bg-emerald-500/10">
                        <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium mb-1">正方观点</div>
                        <div className="text-content-secondary">{item.proView}</div>
                      </div>
                      <div className="p-2 rounded bg-red-500/10">
                        <div className="text-[10px] text-red-600 dark:text-red-400 font-medium mb-1">反方观点</div>
                        <div className="text-content-secondary">{item.conView}</div>
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] text-content-muted">
                      争议原因：{item.reason}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 价值分歧（不可通约） */}
          {result.valueDivergence.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-accent" />
                </div>
                <h2 className="text-lg font-semibold text-accent">价值分歧（不可通约）</h2>
              </div>
              <div className="pl-10">
                <div className="text-xs text-content-muted mb-3 italic">
                  这些分歧没有"正确答案"，关键在于你愿意为什么付出代价。
                </div>
                <div className="space-y-3">
                  {result.valueDivergence.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-lg bg-surface-muted border border-line/60"
                    >
                      <div className="text-sm font-medium text-content-primary mb-3">
                        {item.dimension}
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="p-2 rounded bg-emerald-500/10">
                          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium mb-1">
                            选 A 的代价
                          </div>
                          <div className="text-content-secondary">{item.proCost}</div>
                        </div>
                        <div className="p-2 rounded bg-red-500/10">
                          <div className="text-[10px] text-red-600 dark:text-red-400 font-medium mb-1">
                            选 B 的代价
                          </div>
                          <div className="text-content-secondary">{item.conCost}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* 思考引导 */}
          {result.reflection && (
            <section className="mt-8 p-4 rounded-xl bg-accent/5 border border-accent/20">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-accent mb-1">思考引导</div>
                  <div className="text-sm text-content-secondary leading-relaxed">
                    {result.reflection}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Stats */}
          <div className="flex items-center justify-center gap-6 pt-6 border-t border-line/60 text-xs text-content-muted">
            <div>
              <span className="text-lg font-bold text-emerald-500">{result.factConsensus.length}</span> 条事实共识
            </div>
            <div>
              <span className="text-lg font-bold text-amber-500">{result.factsDisputed.length}</span> 处事实分歧
            </div>
            <div>
              <span className="text-lg font-bold text-accent">{result.valueDivergence.length}</span> 处价值分歧
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
