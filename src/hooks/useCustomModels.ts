import { useCallback, useEffect, useState } from 'react'
import { toast } from '@/lib/toast'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CustomModelForm {
  id?: string | null // editing existing model's dbId; null/empty = creating new
  name: string
  modelId: string
  baseURL: string
  protocol: 'auto' | 'chat' | 'responses' | 'anthropic'
  keySource: 'own' | 'provider' | 'none'
  apiKey: string
  provider?: string // for keySource='provider'
  contextWindow: number
  supportsVision: boolean
  supportsFiles: boolean
  supportsReasoning: boolean
}

export interface SavedCustomModel {
  id: string // custom:xxx (used by ModelSelector)
  dbId: string // DB primary key (edit/delete)
  hasApiKey: boolean
  keySource: 'own' | 'provider' | 'none'
  providerKey?: string | null
  name: string
  modelId: string
  baseURL: string
  protocol: 'auto' | 'chat' | 'responses' | 'anthropic'
  contextWindow: number
  supportsVision: boolean
  supportsFiles: boolean
  supportsReasoning: boolean
  updatedAt: string
}

export interface CustomModelPreset {
  /** 内置预设无 id；用户预设必填（用于 CRUD 标识） */
  id?: string
  name: string
  baseURL: string
  /** 内置 = true；用户 = false（默认） */
  isBuiltIn?: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * 内置预设：只读，随代码发布；用户无法删除/编辑。
 * 兼容旧导入 `CUSTOM_MODEL_PRESETS`，仍可用 .map() 取 name/baseURL。
 */
export const CUSTOM_MODEL_PRESETS: readonly CustomModelPreset[] = [
  { name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', isBuiltIn: true },
  { name: 'SiliconFlow', baseURL: 'https://api.siliconflow.cn/v1', isBuiltIn: true },
  { name: 'Ollama 本地', baseURL: 'http://localhost:11434/v1', isBuiltIn: true },
  { name: 'LM Studio', baseURL: 'http://localhost:1234/v1', isBuiltIn: true },
  { name: 'vLLM', baseURL: 'http://localhost:8000/v1', isBuiltIn: true },
] as const

/** 与 ModelSelector 中自定义模型小圆点颜色保持一致 */
export const CUSTOM_MODEL_DOT = 'bg-gray-400'

/** 用户自定义预设 localStorage key */
const USER_PRESETS_STORAGE_KEY = 'aichatt:custom_model_presets:v1'

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function makeEmptyForm(): CustomModelForm {
  return {
    id: null,
    name: '',
    modelId: '',
    baseURL: 'https://',
    protocol: 'auto',
    keySource: 'own',
    apiKey: '',
    provider: '',
    contextWindow: 32768,
    supportsVision: false,
    supportsFiles: false,
    supportsReasoning: false,
  }
}

// ---------------------------------------------------------------------------
// localStorage 工具
// ---------------------------------------------------------------------------

function loadUserPresetsFromStorage(): CustomModelPreset[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(USER_PRESETS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // 校验 + 兼容旧格式(只有 name/baseURL)
    return parsed
      .filter(
        (p): p is CustomModelPreset =>
          p && typeof p === 'object' && typeof p.name === 'string' && typeof p.baseURL === 'string'
      )
      .map((p) => ({
        id: typeof p.id === 'string' ? p.id : undefined,
        name: p.name,
        baseURL: p.baseURL,
        isBuiltIn: false,
      }))
  } catch {
    return []
  }
}

function saveUserPresetsToStorage(presets: CustomModelPreset[]) {
  if (typeof window === 'undefined') return
  try {
    // 只持久化用户预设（不含内置）
    const payload = presets
      .filter((p) => !p.isBuiltIn)
      .map((p) => ({ id: p.id, name: p.name, baseURL: p.baseURL }))
    window.localStorage.setItem(USER_PRESETS_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // 静默失败：隐私模式 / 配额超出时不影响功能
  }
}

function generatePresetId(): string {
  return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseCustomModelsOptions {
  /**
   * Hook 在保存/删除/测试成功或失败时回调，外层用它显示 toast/banner。
   * 解耦 UI 显示层，hook 不依赖任何具体的消息组件。
   */
  onMessage?: (msg: { type: 'success' | 'error'; text: string }) => void
}

export interface UseCustomModelsReturn {
  // data
  customModels: SavedCustomModel[]
  /** 仅用户自定义的预设（不含内置） */
  userPresets: CustomModelPreset[]
  /** 内置 + 用户预设的合并列表（用户预设排在前） */
  allPresets: CustomModelPreset[]

  // form state
  cmForm: CustomModelForm
  cmFormOpen: boolean

  // status
  cmSaving: boolean
  cmTesting: string | null
  cmDeleting: string | null
  cmFormResult: 'success' | 'error' | null
  cmTestResult: Record<string, 'success' | 'error'>

  // form setters (exposed because UI needs to bind inputs)
  setCmForm: React.Dispatch<React.SetStateAction<CustomModelForm>>
  setCmFormOpen: (open: boolean) => void

  // actions
  loadCustomModels: (list: SavedCustomModel[]) => void
  applyPreset: (preset: CustomModelPreset) => void
  startEdit: (model: SavedCustomModel) => void
  resetForm: () => void
  saveModel: () => Promise<void>
  deleteModel: (dbId: string) => Promise<void>
  testModel: (id?: string, autoDetect?: boolean) => Promise<void>

  // 用户预设 CRUD
  addUserPreset: (name: string, baseURL: string) => CustomModelPreset | null
  updateUserPreset: (id: string, name: string, baseURL: string) => boolean
  removeUserPreset: (id: string) => void
}

export function useCustomModels(opts: UseCustomModelsOptions = {}): UseCustomModelsReturn {
  const { onMessage } = opts

  const [customModels, setCustomModels] = useState<SavedCustomModel[]>([])
  const [userPresets, setUserPresets] = useState<CustomModelPreset[]>([])
  const [cmForm, setCmForm] = useState<CustomModelForm>(makeEmptyForm())
  const [cmSaving, setCmSaving] = useState(false)
  const [cmTesting, setCmTesting] = useState<string | null>(null)
  const [cmTestResult, setCmTestResult] = useState<Record<string, 'success' | 'error'>>({})
  const [cmDeleting, setCmDeleting] = useState<string | null>(null)
  const [cmFormResult, setCmFormResult] = useState<'success' | 'error' | null>(null)
  const [cmFormOpen, setCmFormOpen] = useState(false)

  // 初始化：从 localStorage 读取用户预设
  useEffect(() => {
    setUserPresets(loadUserPresetsFromStorage())
  }, [])

  const notify = useCallback(
    (type: 'success' | 'error', text: string) => {
      // 默认走全局 iziToast;若调用方传入 onMessage 则走自定义回调
      if (onMessage) {
        onMessage({ type, text })
        return
      }
      if (type === 'success') toast.success(text)
      else toast.error(text)
    },
    [onMessage]
  )

  const loadCustomModels = useCallback((list: SavedCustomModel[]) => {
    setCustomModels(
      list.map((m) => ({ ...m, updatedAt: new Date().toISOString() }))
    )
  }, [])

  const applyPreset = useCallback((preset: CustomModelPreset) => {
    setCmForm((f) => ({ ...f, baseURL: preset.baseURL }))
  }, [])

  const resetForm = useCallback(() => {
    setCmForm(makeEmptyForm())
    setCmFormResult(null)
  }, [])

  const startEdit = useCallback((model: SavedCustomModel) => {
    setCmForm({
      id: model.dbId,
      name: model.name,
      modelId: model.modelId,
      baseURL: model.baseURL,
      protocol: (model.protocol as CustomModelForm['protocol']) || 'auto',
      keySource: model.keySource,
      apiKey: '',
      provider: model.providerKey || '',
      contextWindow: model.contextWindow,
      supportsVision: model.supportsVision,
      supportsFiles: model.supportsFiles,
      supportsReasoning: model.supportsReasoning,
    })
    setCmFormResult(null)
    setCmFormOpen(true)
  }, [])

  const saveModel = useCallback(async () => {
    const { name, modelId, baseURL } = cmForm
    // 'https://' 是占位默认值，视为未填
    const cleanBaseURL = baseURL && baseURL.trim() !== 'https://' ? baseURL.trim() : ''

    if (!name || !modelId) {
      notify('error', '名称和模型 ID 是必填项')
      return
    }
    if (cmForm.keySource === 'provider' && !cmForm.provider) {
      notify('error', '请选择要复用的服务商')
      return
    }
    if (cmForm.keySource !== 'provider' && !cleanBaseURL) {
      notify('error', 'Base URL 是必填项（复用服务商 Key 时可留空）')
      return
    }

    setCmSaving(true)
    try {
      const body = {
        ...cmForm,
        baseURL: cleanBaseURL,
        keyProvider: cmForm.keySource === 'provider' ? cmForm.provider : undefined,
        apiKey: cmForm.keySource === 'own' ? cmForm.apiKey : '',
      }
      const res = await fetch('/api/custom-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('保存失败')

      const data = await res.json()
      setCustomModels((prev) =>
        cmForm.id
          ? prev.map((m) =>
              m.dbId === cmForm.id
                ? ({ ...data, updatedAt: new Date().toISOString() } as SavedCustomModel)
                : m
            )
          : [...prev, { ...data, updatedAt: new Date().toISOString() } as SavedCustomModel]
      )
      resetForm()
      notify('success', '自定义模型已保存')
    } catch (err) {
      notify('error', err instanceof Error ? err.message : '保存失败')
    } finally {
      setCmSaving(false)
    }
  }, [cmForm, notify, resetForm])

  const deleteModel = useCallback(
    async (dbId: string) => {
      if (!confirm('确定要删除此自定义模型吗？')) return
      setCmDeleting(dbId)
      try {
        await fetch(`/api/custom-models/${dbId}`, { method: 'DELETE' })
        setCustomModels((prev) => prev.filter((m) => m.dbId !== dbId))
        notify('success', '模型已删除')
      } catch {
        notify('error', '删除失败')
      } finally {
        setCmDeleting(null)
        // 检查是否在删除正在编辑的模型（保持原行为）
        if (cmForm.id === dbId) {
          resetForm()
        }
      }
    },
    [cmForm.id, notify, resetForm]
  )

  const testModel = useCallback(
    async (id?: string, autoDetect = false) => {
      const targetId = id || `${Date.now()}` // temp id for testing draft
      setCmTesting(targetId)
      setCmFormResult(null)
      setCmTestResult((r) => {
        const next = { ...r }
        delete next[targetId]
        return next
      })
      try {
        const body = {
          ...(id
            ? { id }
            : {
                ...cmForm,
                keyProvider: cmForm.keySource === 'provider' ? cmForm.provider : undefined,
                apiKey: cmForm.keySource === 'own' ? cmForm.apiKey : '',
              }),
          detectCapabilities: autoDetect,
        }
        const res = await fetch('/api/custom-models/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
          capabilities?: { supportsVision: boolean; supportsReasoning: boolean }
        }
        if (json.ok) {
          setCmTestResult((r) => ({ ...r, [targetId]: 'success' }))
          setCmFormResult('success')
          if (json.capabilities && autoDetect) {
            setCmForm((f) => ({
              ...f,
              supportsVision: json.capabilities!.supportsVision,
              supportsReasoning: json.capabilities!.supportsReasoning,
            }))
            const detected: string[] = []
            if (json.capabilities.supportsVision) detected.push('视觉')
            if (json.capabilities.supportsReasoning) detected.push('推理')
            if (detected.length > 0) {
              notify('success', `连接成功，已自动启用：${detected.join('、')}`)
            } else {
              notify('success', '连接成功，未检测到额外能力')
            }
          } else {
            notify('success', '连接测试成功')
          }
        } else {
          setCmTestResult((r) => ({ ...r, [targetId]: 'error' }))
          setCmFormResult('error')
          notify('error', json.error || `测试失败（HTTP ${res.status}）`)
        }
      } catch (err) {
        setCmTestResult((r) => ({ ...r, [targetId]: 'error' }))
        setCmFormResult('error')
        notify('error', err instanceof Error ? err.message : '测试请求失败')
      } finally {
        setCmTesting(null)
      }
    },
    [cmForm, notify]
  )

  // ── 用户预设 CRUD ───────────────────────────────────────────────────────

  const addUserPreset = useCallback(
    (name: string, baseURL: string): CustomModelPreset | null => {
      const cleanName = name.trim()
      const cleanURL = baseURL.trim()
      if (!cleanName) {
        notify('error', '预设名称不能为空')
        return null
      }
      if (!cleanURL || !/^https?:\/\//i.test(cleanURL)) {
        notify('error', 'Base URL 必须以 http:// 或 https:// 开头')
        return null
      }
      // 重名检查（包含内置 + 用户）
      const dup = userPresets.some(
        (p) => p.name.toLowerCase() === cleanName.toLowerCase()
      ) || CUSTOM_MODEL_PRESETS.some(
        (p) => p.name.toLowerCase() === cleanName.toLowerCase()
      )
      if (dup) {
        notify('error', '已存在同名预设')
        return null
      }
      const preset: CustomModelPreset = {
        id: generatePresetId(),
        name: cleanName,
        baseURL: cleanURL,
        isBuiltIn: false,
      }
      setUserPresets((prev) => {
        const next = [...prev, preset]
        saveUserPresetsToStorage(next)
        return next
      })
      notify('success', `已添加预设：${cleanName}`)
      return preset
    },
    [notify, userPresets]
  )

  const updateUserPreset = useCallback(
    (id: string, name: string, baseURL: string): boolean => {
      const cleanName = name.trim()
      const cleanURL = baseURL.trim()
      if (!cleanName) {
        notify('error', '预设名称不能为空')
        return false
      }
      if (!cleanURL || !/^https?:\/\//i.test(cleanURL)) {
        notify('error', 'Base URL 必须以 http:// 或 https:// 开头')
        return false
      }
      let success = false
      setUserPresets((prev) => {
        // 找到目标
        const target = prev.find((p) => p.id === id)
        if (!target) return prev
        // 重名检查（排除自己）
        const dup = prev.some(
          (p) => p.id !== id && p.name.toLowerCase() === cleanName.toLowerCase()
        ) || CUSTOM_MODEL_PRESETS.some(
          (p) => p.name.toLowerCase() === cleanName.toLowerCase()
        )
        if (dup) {
          // 失败：返回原数组（不修改）
          success = false
          notify('error', '已存在同名预设')
          return prev
        }
        const next = prev.map((p) =>
          p.id === id ? { ...p, name: cleanName, baseURL: cleanURL } : p
        )
        saveUserPresetsToStorage(next)
        success = true
        return next
      })
      if (success) notify('success', '预设已更新')
      return success
    },
    [notify]
  )

  const removeUserPreset = useCallback(
    (id: string) => {
      const target = userPresets.find((p) => p.id === id)
      if (!target) return
      if (!confirm(`确定要删除预设"${target.name}"吗？`)) return
      setUserPresets((prev) => {
        const next = prev.filter((p) => p.id !== id)
        saveUserPresetsToStorage(next)
        return next
      })
      notify('success', '预设已删除')
    },
    [notify, userPresets]
  )

  // 合并预设列表（用户在前，内置在后）
  const allPresets: CustomModelPreset[] = [
    ...userPresets,
    ...CUSTOM_MODEL_PRESETS.map((p) => ({ ...p, isBuiltIn: true })),
  ]

  return {
    // data
    customModels,
    userPresets,
    allPresets,
    // form
    cmForm,
    cmFormOpen,
    // status
    cmSaving,
    cmTesting,
    cmDeleting,
    cmFormResult,
    cmTestResult,
    // form setters
    setCmForm,
    setCmFormOpen,
    // actions
    loadCustomModels,
    applyPreset,
    startEdit,
    resetForm,
    saveModel,
    deleteModel,
    testModel,
    // 用户预设 CRUD
    addUserPreset,
    updateUserPreset,
    removeUserPreset,
  }
}
