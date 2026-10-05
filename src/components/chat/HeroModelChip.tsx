'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { ModelQuickSheet } from './ModelQuickSheet'
import type { ModelDefinition } from '@/lib/ai/types'

/**
 * 方案 C 欢迎页 hero 模型胶囊(≤md,md:hidden):问候语副标题里的玻璃小胶囊,
 * 显示当前模型名 + 下拉箭头,点击弹 iOS 半屏快切(ModelQuickSheet)。
 * 副标题整行可点;材质用中性玻璃(bg-surface-muted/70),壁纸开关两种状态下都可读。
 */
export function HeroModelChip({
  models,
  selectedModel,
  onModelChange,
}: {
  models: ModelDefinition[]
  selectedModel: string
  onModelChange: (modelId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = models.find((m) => m.id === selectedModel)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="md:hidden inline-flex items-center gap-1 align-middle rounded-full border border-line/70 bg-surface-muted/70 px-2.5 py-0.5 text-[11.5px] font-medium text-content-primary active:scale-95 transition-transform touch-manipulation"
        style={{ WebkitBackdropFilter: 'blur(8px)', backdropFilter: 'blur(8px)', WebkitTapHighlightColor: 'transparent' }}
        aria-label="切换模型"
      >
        {current?.name ?? selectedModel}
        <ChevronDown className="h-2.5 w-2.5 opacity-80" />
      </button>
      <ModelQuickSheet
        open={open}
        onClose={() => setOpen(false)}
        models={models}
        selectedModel={selectedModel}
        onModelChange={onModelChange}
      />
    </>
  )
}
