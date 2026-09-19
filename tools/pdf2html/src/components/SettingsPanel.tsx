/**
 * AI 接口设置弹窗:OpenAI 兼容中转站 + 视觉模型 + 页面清晰度/页码范围。
 * 保存写入 localStorage;API Key 只留在本地,不上传任何服务器。
 */
import { useEffect, useState } from 'react'
import type { AiSettings } from '../lib/ai/settings'

interface Props {
  open: boolean
  initial: AiSettings
  onClose: () => void
  onSave: (settings: AiSettings) => void
}

const SCALE_OPTIONS = [
  { value: 1.5, label: '1.5x · 快速省 token' },
  { value: 2, label: '2x · 均衡(默认)' },
  { value: 2.5, label: '2.5x · 精细' },
  { value: 3, label: '3x · 高清,数学密排页推荐' },
]

const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400'

export default function SettingsPanel({ open, initial, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<AiSettings>(initial)

  useEffect(() => {
    if (open) setDraft(initial)
  }, [open, initial])

  if (!open) return null

  const set = <K extends keyof AiSettings>(key: K, value: AiSettings[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">AI 结构化设置</h2>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">
          OpenAI 兼容接口 + 支持识图的模型。页面截图会发送到你配置的接口;
          页数多时耗时且耗 token,建议先用"页码范围"试转几页。
        </p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600">接口地址(Base URL)</span>
            <input
              className={inputCls}
              value={draft.baseUrl}
              onChange={(e) => set('baseUrl', e.target.value)}
              placeholder="https://你的中转站/v1"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600">API Key</span>
            <input
              className={inputCls}
              type="password"
              value={draft.apiKey}
              onChange={(e) => set('apiKey', e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600">模型名(需支持图片输入)</span>
            <input
              className={inputCls}
              value={draft.model}
              onChange={(e) => set('model', e.target.value)}
              placeholder="gemini-2.5-flash / gpt-4o / qwen-vl-max ..."
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="mb-1 block text-xs font-medium text-neutral-600">页面清晰度</span>
              <select
                className={inputCls}
                value={draft.imageScale}
                onChange={(e) => set('imageScale', Number(e.target.value))}
              >
                {SCALE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block flex-1">
              <span className="mb-1 block text-xs font-medium text-neutral-600">页码范围(可选)</span>
              <input
                className={inputCls}
                value={draft.pageRange}
                onChange={(e) => set('pageRange', e.target.value)}
                placeholder="如 20-35,留空转换全部"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-neutral-400">
          请求由浏览器直连中转站;若控制台报跨域(CORS)错误,请换支持跨域的中转站。
          Key 仅保存在本机浏览器,不会上传。
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="rounded-lg bg-neutral-800 px-4 py-2 text-sm text-white hover:bg-neutral-700"
            onClick={() => onSave(draft)}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
