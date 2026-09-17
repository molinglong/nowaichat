'use client'

import { Settings as SettingsIcon } from 'lucide-react'
import { BUILTIN_MASKS } from '@/lib/ai/builtin-masks'
import type { MaskDTO } from '@/lib/ai/mask-types'

interface MaskPickerMenuProps {
  /** 当前生效面具 id(菜单项高亮);空表示未使用面具 */
  activeMaskId?: string | null
  /** 自定义面具列表(「我的面具」分组);未加载/为空时隐藏分组 */
  userMasks?: MaskDTO[]
  /** 选择某个面具 */
  onSelect: (maskId: string) => void
  /** 打开面具管理(设置页 masks 分区) */
  onManage: () => void
  /** 清除面具(不使用) */
  onClear: () => void
}

/**
 * 面具选择菜单主体: 内置面具 + 我的面具 + 管理入口 + 不使用面具。
 * 只渲染菜单内容本身,定位/遮罩/开合由调用方包裹
 * (对话页顶栏 chip 与欢迎页「面具」胶囊共用)。
 */
export function MaskPickerMenu({
  activeMaskId,
  userMasks,
  onSelect,
  onManage,
  onClear,
}: MaskPickerMenuProps) {
  return (
    <>
      {BUILTIN_MASKS.map((m) => (
        <button
          key={m.id}
          onClick={() => onSelect(m.id)}
          role="menuitem"
          className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors
            ${m.id === activeMaskId ? 'bg-surface-muted' : 'hover:bg-surface-subtle'}`}
        >
          <span className="text-base leading-5 shrink-0" aria-hidden>{m.avatar}</span>
          <span className="min-w-0">
            <span className="block text-xs font-medium text-content-primary">{m.name}</span>
            <span className="block text-[11px] text-content-muted truncate">{m.description}</span>
          </span>
        </button>
      ))}
      {(userMasks?.length ?? 0) > 0 && (
        <>
          <div className="px-3 pt-2 pb-1 text-[10px] font-medium text-content-muted/70 uppercase tracking-wide">
            我的面具
          </div>
          {(userMasks ?? []).map((m) => (
            <button
              key={m.id}
              onClick={() => onSelect(m.id)}
              role="menuitem"
              className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors
                ${m.id === activeMaskId ? 'bg-surface-muted' : 'hover:bg-surface-subtle'}`}
            >
              <span className="text-base leading-5 shrink-0" aria-hidden>{m.avatar}</span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-content-primary">{m.name}</span>
                <span className="block text-[11px] text-content-muted truncate">{m.description}</span>
              </span>
            </button>
          ))}
        </>
      )}
      <div className="my-1 border-t border-line" />
      <button
        onClick={onManage}
        role="menuitem"
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs text-content-muted
          hover:bg-surface-subtle transition-colors"
      >
        <SettingsIcon className="w-4 h-4 shrink-0" aria-hidden />
        <span>管理面具（新增/编辑/删除）</span>
      </button>
      <button
        onClick={onClear}
        role="menuitem"
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs text-content-muted
          hover:bg-surface-subtle transition-colors"
      >
        <span className="text-base leading-5" aria-hidden>✕</span>
        <span>不使用面具</span>
      </button>
    </>
  )
}
