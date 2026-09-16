'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ModelDefinition } from '@/lib/ai/types'
import { PROVIDER_DOT, PROVIDER_NAMES } from '@/lib/ai/provider-meta'

interface ModelSelectorProps {
  models: ModelDefinition[]
  value: string
  onChange: (modelId: string) => void
  compact?: boolean
}

export function ModelSelector({ models, value, onChange, compact = false }: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [configuredProviders, setConfiguredProviders] = useState<Set<string>>(new Set())
  const ref = useRef<HTMLDivElement>(null)

  const currentModel = models.find(m => m.id === value)

  useEffect(() => {
    fetch('/api/keys')
      .then((r) => r.json())
      .then((keys: { provider: string }[]) => {
        setConfiguredProviders(new Set(keys.map((k) => k.provider)))
      })
      .catch(() => {})
  }, [])

  const filteredModels = models.filter(
    (m) => configuredProviders.has(m.provider) || m.provider === 'custom'
  )

  const grouped = filteredModels.reduce<Record<string, { providerName: string; models: ModelDefinition[] }>>(
    (acc, model) => {
      if (!acc[model.provider]) {
        acc[model.provider] = {
          providerName: PROVIDER_NAMES[model.provider] || model.provider,
          models: [],
        }
      }
      acc[model.provider].models.push(model)
      return acc
    },
    {}
  )

  useEffect(() => {
    if (!open) return
    fetch('/api/keys')
      .then((r) => r.json())
      .then((keys: { provider: string }[]) => {
        setConfiguredProviders(new Set(keys.map((k) => k.provider)))
      })
      .catch(() => {})
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (compact) {
    return (
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1 px-2 py-1 rounded text-content-secondary hover:text-content-primary hover:bg-surface-muted transition-colors"
        >
          <span className="text-xs font-medium max-w-[100px] truncate">
            {currentModel?.name || value}
          </span>
          <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="absolute top-full left-0 mt-1 w-56 max-h-60 overflow-y-auto bg-surface border border-line/60 rounded-lg shadow-xl z-50 py-1">
            {Object.keys(grouped).length > 0 ? (
              Object.entries(grouped).map(([providerId, { providerName, models: providerModels }]) => (
                <div key={providerId}>
                  <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold text-content-muted uppercase tracking-wider">
                    <span className={cn('w-1.5 h-1.5 rounded-full', PROVIDER_DOT[providerId] ?? 'bg-content-muted')} />
                    {providerName}
                  </div>
                  {providerModels.map(model => (
                    <button
                      key={model.id}
                      onClick={() => { onChange(model.id); setOpen(false) }}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-surface-subtle transition-colors',
                        model.id === value && 'bg-accent/10 text-accent'
                      )}
                    >
                      <span className="flex-1 truncate">{model.name}</span>
                      {model.id === value && <Check className="w-3 h-3 shrink-0" />}
                    </button>
                  ))}
                </div>
              ))
            ) : (
              <div className="px-3 py-4 text-center text-xs text-content-muted">
                请先在设置中配置 API Key
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface-muted border border-line/60 hover:bg-surface-subtle transition-colors"
      >
        <span className="text-sm truncate">{currentModel?.name || value}</span>
        <ChevronDown className={cn('w-4 h-4 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-surface border border-line/60 rounded-lg shadow-xl z-50 py-1">
          {Object.keys(grouped).length > 0 ? (
            Object.entries(grouped).map(([providerId, { providerName, models: providerModels }]) => (
              <div key={providerId}>
                <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold text-content-muted uppercase tracking-wider">
                  <span className={cn('w-1.5 h-1.5 rounded-full', PROVIDER_DOT[providerId] ?? 'bg-content-muted')} />
                  {providerName}
                </div>
                {providerModels.map(model => (
                  <button
                    key={model.id}
                    onClick={() => { onChange(model.id); setOpen(false) }}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-surface-subtle transition-colors',
                      model.id === value && 'bg-accent/10 text-accent'
                    )}
                  >
                    <span className="flex-1 truncate">{model.name}</span>
                    {model.id === value && <Check className="w-3 h-3 shrink-0" />}
                  </button>
                ))}
              </div>
            ))
          ) : (
            <div className="px-3 py-4 text-center text-xs text-content-muted">
              请先在设置中配置 API Key
            </div>
          )}
        </div>
      )}
    </div>
  )
}
