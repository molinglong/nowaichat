'use client'

import { useState, useRef, useEffect, useLayoutEffect, useMemo, memo } from 'react'
import { createPortal } from 'react-dom'
import { Brain, Globe, Search, ChevronDown, Star, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSingleFlight } from '@/hooks/useSingleFlight'
import { useChatStore } from '@/store/chat-store'
import type { ModelDefinition } from '@/lib/ai/types'
import { PROVIDER_DOT, PROVIDER_NAMES } from '@/lib/ai/provider-meta'

export { PROVIDER_DOT, PROVIDER_NAMES }

interface ModelSelectorProps {
  models: ModelDefinition[]
  selectedModel: string
  onModelChange: (modelId: string) => void
  className?: string
  compact?: boolean
  // 深度思考开关
  deepThink?: boolean
  onDeepThinkChange?: (enabled: boolean) => void
  // 联网搜索开关
  webSearch?: boolean
  onWebSearchChange?: (enabled: boolean) => void
  webSearchAvailable?: boolean
}

export function ModelSelector({
  models,
  selectedModel,
  onModelChange,
  className,
  compact = false,
  deepThink = false,
  onDeepThinkChange,
  webSearch = false,
  onWebSearchChange,
  webSearchAvailable = false,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [configuredProviders, setConfiguredProviders] = useState<Set<string>>(new Set())
  const [mounted, setMounted] = useState(false)
  // 用 ref 存位置 —— 每次更新不需要重新渲染
  const dropdownPositionRef = useRef({ top: 0, left: 0, width: 0 })
  // visible 控制 opacity 动画:false=0, true=1
  const [dropdownVisible, setDropdownVisible] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(new Set())
  const searchInputRef = useRef<HTMLInputElement>(null)
  const dropdownMenuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // ⭐ / 🕐 store 状态(收藏 + 最近持久化在 store + localStorage)
  const favoriteModels = useChatStore((s) => s.favoriteModels)
  const recentModels = useChatStore((s) => s.recentModels)
  const toggleFavoriteModel = useChatStore((s) => s.toggleFavoriteModel)
  const recordModelUsage = useChatStore((s) => s.recordModelUsage)
  const modelSpecialSectionsCollapsed = useChatStore(
    (s) => s.modelSpecialSectionsCollapsed
  )
  const toggleModelSpecialSection = useChatStore(
    (s) => s.toggleModelSpecialSection
  )

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    // 已配置 Key 的 provider 名单。用 /api/providers/keys-status 而非 /api/keys:
    // 后者返回掩码密钥，临时聊天模式下被 middleware 整体 403，会导致模型列表全空
    fetch('/api/providers/keys-status')
      .then((r) => r.json())
      .then((keys: { provider: string }[]) => {
        setConfiguredProviders(new Set(keys.map((k) => k.provider)))
      })
      .catch(() => {})
  }, [isOpen])

  // 更新下拉菜单位置 —— 用 ref 存,不影响渲染
  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return
    const updatePosition = () => {
      const rect = buttonRef.current!.getBoundingClientRect()
      const dropdownMinWidth = 260
      const dropdownMaxWidth = 320
      const gap = 4
      const margin = 8

      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      // 水平位置:水平居中于按钮下方,边界时贴边
      let left = rect.left
      if (left + dropdownMaxWidth + margin > viewportWidth) {
        left = Math.max(margin, viewportWidth - dropdownMaxWidth - margin)
      }

      // 垂直位置:总是先尝试按钮下方,实测菜单高度后再决定是否翻转
      const desiredTop = rect.bottom + gap
      // 用真实菜单高度判断(如果已经渲染了);否则保守用 200(通常够)
      const actualHeight = dropdownMenuRef.current?.offsetHeight ?? 200
      if (desiredTop + actualHeight + margin > viewportHeight) {
        // 下方空间不够,翻到按钮上方
        const topUp = rect.top - actualHeight - gap
        if (topUp >= margin) {
          dropdownPositionRef.current = { top: topUp, left, width: rect.width }
          return
        }
      }
      dropdownPositionRef.current = { top: desiredTop, left, width: rect.width }
    }
    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [isOpen, compact])

  // 打开/关闭动画状态机
  useEffect(() => {
    if (isOpen) {
      // 打开:两帧延迟后设置 visible,确保 opacity 过渡动画正确触发
      let frame2: number | null = null
      const frame1 = requestAnimationFrame(() => {
        frame2 = requestAnimationFrame(() => {
          setDropdownVisible(true)
          searchInputRef.current?.focus()
        })
      })
      return () => {
        cancelAnimationFrame(frame1)
        if (frame2 !== null) cancelAnimationFrame(frame2)
      }
    } else {
      // 关闭:先淡出,等 transition 结束后再隐藏
      setDropdownVisible(false)
    }
  }, [isOpen])

  // 收敛 grouped —— models / configuredProviders 不变时不再重算
  const grouped = useMemo(() => {
    return models.reduce<Record<string, { providerName: string; models: ModelDefinition[] }>>(
      (acc, model) => {
        if (!configuredProviders.has(model.provider) && model.provider !== 'custom') return acc
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
  }, [models, configuredProviders])

  // 搜索过滤 + 折叠状态综合后的可见模型
  const visibleGrouped = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const result: Record<string, { providerName: string; models: ModelDefinition[] }> = {}
    for (const [providerId, group] of Object.entries(grouped)) {
      const filteredModels = q
        ? group.models.filter(
            (m) =>
              m.name.toLowerCase().includes(q) ||
              group.providerName.toLowerCase().includes(q)
          )
        : group.models
      if (filteredModels.length > 0) {
        result[providerId] = { ...group, models: filteredModels }
      }
    }
    return result
  }, [grouped, searchQuery])

  // ⭐ / 🕐 特殊分组:跟随搜索过滤,跟随 configuredProviders 收敛
  const specialGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const isVisibleModel = (m: ModelDefinition) =>
      (configuredProviders.has(m.provider) || m.provider === 'custom') &&
      (!q ||
        m.name.toLowerCase().includes(q) ||
        (PROVIDER_NAMES[m.provider] || m.provider).toLowerCase().includes(q))

    const favorites = favoriteModels
      .map((id) => models.find((m) => m.id === id))
      .filter((m): m is ModelDefinition => m != null && isVisibleModel(m))
    const recent = recentModels
      .map((id) => models.find((m) => m.id === id))
      .filter((m): m is ModelDefinition => m != null && isVisibleModel(m))

    // 收藏里出现过的模型从"最近"里隐藏(避免视觉重复)
    const favoriteIds = new Set(favorites.map((m) => m.id))
    const filteredRecent = recent.filter((m) => !favoriteIds.has(m.id))

    return { favorites, recent: filteredRecent }
  }, [models, configuredProviders, favoriteModels, recentModels, searchQuery])

  // 切换分组折叠
  const toggleProvider = (providerId: string) => {
    setCollapsedProviders((prev) => {
      const next = new Set(prev)
      if (next.has(providerId)) {
        next.delete(providerId)
      } else {
        next.add(providerId)
      }
      return next
    })
  }

  // 判断某分组是否折叠:搜索时全部展开;无搜索时看 collapsedProviders
  const isProviderCollapsed = (providerId: string) => {
    if (searchQuery.trim()) return false
    return collapsedProviders.has(providerId)
  }

  const selected = useMemo(
    () => models.find((m) => m.id === selectedModel),
    [models, selectedModel]
  )

  const handleModelChangeDebounced = useSingleFlight((modelId: string) => {
    onModelChange(modelId)
    recordModelUsage(modelId)
    setIsOpen(false)
  }, [onModelChange, recordModelUsage])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownMenuRef.current &&
        !dropdownMenuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <div className={cn('relative', className)}>
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          compact
            // 触屏 ≥44px 触控目标;桌面端保持 28px 紧凑
            ? 'flex items-center h-7 min-h-[44px] sm:min-h-0 px-2.5 rounded-full text-[11px] font-medium bg-surface-muted hover:bg-surface-subtle text-content-secondary'
            : 'flex items-center gap-2 min-h-[44px] sm:min-h-0 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-surface-subtle text-content-secondary',
          'transition-colors'
        )}
      >
        <span className={cn(compact ? 'max-w-[100px]' : 'max-w-[160px]', 'truncate')}>{selected?.name || selectedModel}</span>
      </button>

      {isOpen && mounted && createPortal(
        <div
          ref={dropdownMenuRef}
          className={cn(
            'fixed z-[9999]',
            'min-w-[260px] max-w-[300px] max-h-[320px]',
            'flex flex-col',
            'bg-surface-muted rounded-xl border border-line/60 shadow-lg',
            'py-1 overflow-hidden',
            // 仅过渡 opacity(纯 CSS transition,不依赖 tailwindcss-animate 插件)
            'transition-opacity duration-200 ease-out'
          )}
          style={{
            top: `${dropdownPositionRef.current.top}px`,
            left: `${dropdownPositionRef.current.left}px`,
            width: dropdownPositionRef.current.width ? `${dropdownPositionRef.current.width}px` : undefined,
            // 上下翻转交给 useLayoutEffect 处理(根据视口空间自动算 top),
            // 此处不再额外加 transform,避免双重偏移
            opacity: dropdownVisible ? 1 : 0,
          }}
        >
          {/* 功能开关区域 */}
          <div className="flex items-center gap-1.5 px-2 py-2 border-b border-line/60 shrink-0">
            {onDeepThinkChange && (
              <button
                onClick={() => onDeepThinkChange(!deepThink)}
                className={cn(
                  // min-h-[44px] sm:min-h-0:触屏 ≥44px,桌面端取消下限
                  'group flex-1 flex items-center justify-center gap-1.5 h-7 min-h-[44px] sm:min-h-0 px-2.5 rounded-lg',
                  'text-[12px] font-medium transition-all duration-200',
                  deepThink
                    ? 'bg-accent text-accent-foreground border border-transparent shadow-sm'
                    : 'bg-transparent text-content-secondary border border-line/60 hover:bg-surface-subtle hover:border-line',
                  'active:scale-[0.97]'
                )}
                title="深度思考"
              >
                <Brain className="w-3.5 h-3.5 shrink-0" />
                <span>深度思考</span>
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full transition-all duration-200',
                    deepThink
                      ? 'bg-current scale-100'
                      : 'bg-content-muted/40 scale-75'
                  )}
                />
              </button>
            )}
            {onWebSearchChange && (
              <button
                onClick={() => onWebSearchChange(!webSearch)}
                disabled={!webSearchAvailable}
                className={cn(
                  // 移动端 ≥44px 触控目标,桌面端保留 28px 紧凑
                  'group flex-1 flex items-center justify-center gap-1.5 h-7 min-h-[44px] sm:min-h-0 px-2.5 rounded-lg',
                  'text-[12px] font-medium transition-all duration-200',
                  webSearch
                    ? 'bg-accent text-accent-foreground border border-transparent shadow-sm'
                    : 'bg-transparent text-content-secondary border border-line/60 hover:bg-surface-subtle hover:border-line',
                  !webSearchAvailable && 'opacity-60 cursor-not-allowed hover:bg-transparent hover:border-line/60',
                  'active:scale-[0.97]'
                )}
                title={webSearchAvailable ? '智能搜索' : '请先在设置中配置搜索 API Key'}
              >
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span>智能搜索</span>
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full transition-all duration-200',
                    webSearch
                      ? 'bg-current scale-100'
                      : webSearchAvailable
                        ? 'bg-content-muted/40 scale-75'
                        : 'bg-line scale-50'
                  )}
                />
              </button>
            )}
          </div>

          {/* 搜索框 */}
          <div className="px-2 py-1.5 border-b border-line/60 shrink-0">
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 w-3.5 h-3.5 text-content-muted pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索模型..."
                className={cn(
                  'w-full h-7 pl-8 pr-2 rounded-lg text-xs',
                  'bg-surface-subtle text-content-primary placeholder:text-content-muted',
                  'border border-transparent focus:border-accent/40 focus:outline-none',
                  'transition-colors'
                )}
              />
            </div>
          </div>

          {/* 模型列表(可滚动区域) */}
          <div className="flex-1 overflow-y-auto py-1">
            {(() => {
              // 渲染一个分组(收藏/最近/provider)的 UI:Header + 模型项列表
              const renderGroup = (
                groupKey: string,
                groupName: string,
                icon: React.ReactNode,
                iconClassName: string,
                groupedModels: ModelDefinition[],
                isCollapsed: boolean,
                onToggleCollapsed: () => void
              ) => (
                <div key={groupKey}>
                  <button
                    onClick={onToggleCollapsed}
                    className={cn(
                      'w-full flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider',
                      'text-content-muted hover:text-content-secondary transition-colors'
                    )}
                  >
                    <ChevronDown
                      className={cn(
                        'w-3 h-3 transition-transform duration-200',
                        isCollapsed && '-rotate-90'
                      )}
                    />
                    <span className={cn('w-3.5 h-3.5 inline-flex items-center justify-center', iconClassName)}>
                      {icon}
                    </span>
                    <span className="flex-1 text-left normal-case tracking-normal">{groupName}</span>
                    <span className="text-[10px] font-normal normal-case">{groupedModels.length}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="transition-all duration-150">
                      {groupedModels.map((model) => (
                        <ModelItem
                          key={model.id}
                          model={model}
                          isSelected={model.id === selectedModel}
                          isFavorite={favoriteModels.includes(model.id)}
                          onSelect={handleModelChangeDebounced}
                          onToggleFavorite={toggleFavoriteModel}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )

              const specialsCollapsed = !!searchQuery.trim() // 搜索时全部展开
              const favoritesCollapsed = specialsCollapsed || modelSpecialSectionsCollapsed.favorites
              const recentCollapsed = specialsCollapsed || modelSpecialSectionsCollapsed.recent

              return (
                <>
                  {specialGroups.favorites.length > 0 &&
                    renderGroup(
                      '__favorites',
                      '收藏',
                      <Star className="w-3 h-3" fill="currentColor" />,
                      'text-yellow-500',
                      specialGroups.favorites,
                      favoritesCollapsed,
                      () => toggleModelSpecialSection('favorites')
                    )}
                  {specialGroups.recent.length > 0 &&
                    renderGroup(
                      '__recent',
                      '最近',
                      <Clock className="w-3 h-3" />,
                      'text-content-muted',
                      specialGroups.recent,
                      recentCollapsed,
                      () => toggleModelSpecialSection('recent')
                    )}
                  {Object.entries(visibleGrouped).map(([providerId, { providerName, models: providerModels }]) =>
                    renderGroup(
                      providerId,
                      providerName,
                      <span
                        className={cn(
                          'w-1.5 h-1.5 rounded-full block',
                          PROVIDER_DOT[providerId] ?? 'bg-content-muted'
                        )}
                      />,
                      '',
                      providerModels,
                      isProviderCollapsed(providerId),
                      () => toggleProvider(providerId)
                    )
                  )}
                  {specialGroups.favorites.length === 0 &&
                    specialGroups.recent.length === 0 &&
                    Object.keys(visibleGrouped).length === 0 && (
                      <div className="px-3 py-4 text-center text-xs text-content-muted">
                        {searchQuery.trim() ? '没有匹配的模型' : '请先在设置中配置 API Key'}
                      </div>
                    )}
                </>
              )
            })()}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

/** 模型列表项: memo 避免下拉内其他项重渲 */
interface ModelItemProps {
  model: ModelDefinition
  isSelected: boolean
  isFavorite: boolean
  onSelect: (modelId: string) => void
  onToggleFavorite: (modelId: string) => void
}
const ModelItem = memo(function ModelItem({
  model,
  isSelected,
  isFavorite,
  onSelect,
  onToggleFavorite,
}: ModelItemProps) {
  // 星标按钮事件:阻止冒泡,避免触发外层 onClick(选中)
  const handleToggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    onToggleFavorite(model.id)
  }

  return (
    <button
      onClick={() => onSelect(model.id)}
      className={cn(
        'w-full text-left px-2 py-1 text-xs transition-colors',
        'hover:bg-surface-subtle active:scale-95 touch-manipulation',
        isSelected
          ? 'text-content-primary font-medium bg-accent-soft'
          : 'text-content-secondary'
      )}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="truncate">{model.name}</span>
        <div className="flex items-center gap-1 shrink-0">
          {model.supportsReasoning && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-accent-soft text-content-secondary">
              Reasoning
            </span>
          )}
          {model.supportsVision && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-surface-muted text-content-muted">
              Vision
            </span>
          )}
          {/* ⭐ 星标按钮:点击切换收藏,不选中模型 */}
          <span
            role="button"
            tabIndex={-1}
            aria-label={isFavorite ? '取消收藏' : '收藏'}
            onClick={handleToggleFavorite}
            className={cn(
              'inline-flex items-center justify-center w-4 h-4 rounded transition-all duration-150',
              'hover:bg-surface-muted cursor-pointer',
              isFavorite
                ? 'text-yellow-500 opacity-100'
                : 'text-content-muted opacity-50 hover:opacity-90'
            )}
          >
            <Star
              className="w-3 h-3"
              fill={isFavorite ? 'currentColor' : 'none'}
              strokeWidth={isFavorite ? 0 : 2}
            />
          </span>
        </div>
      </div>
    </button>
  )
})
