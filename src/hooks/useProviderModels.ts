import { useCallback, useEffect, useState } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** ProviderModelOverride 行（来自后端） */
export interface ProviderModelOverrideRow {
  id: string
  provider: string
  modelId: string
  isHidden: boolean
  name: string
  contextWindow: number
  supportsVision: boolean
  supportsFiles: boolean
  supportsReasoning: boolean
  updatedAt: string
}

/** ProviderModelOverride 提交表单（用于新增 / 编辑） */
export interface ProviderModelOverrideForm {
  id?: string
  provider: string
  modelId: string
  isHidden: boolean
  name: string
  contextWindow: number
  supportsVision: boolean
  supportsFiles: boolean
  supportsReasoning: boolean
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function makeEmptyForm(provider = ''): ProviderModelOverrideForm {
  return {
    provider,
    modelId: '',
    isHidden: false,
    name: '',
    contextWindow: 32768,
    supportsVision: false,
    supportsFiles: false,
    supportsReasoning: false,
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseProviderModelsReturn {
  /** 用户在 ProviderModelOverride 表里的全部覆盖记录 */
  overrides: ProviderModelOverrideRow[]
  /** 当前是否正在加载 */
  loading: boolean
  /** 通用错误信息 */
  error: string | null
  /** 当前正在保存 / 删除的记录 id */
  pendingId: string | null

  // actions
  fetchOverrides: () => Promise<void>
  /** 隐藏一个内置预置模型（创建 isHidden=true 的覆盖） */
  hideBuiltin: (provider: string, modelId: string, builtinName?: string) => Promise<boolean>
  /** 取消隐藏一个预置模型（删除对应的 isHidden 覆盖） */
  unhideBuiltin: (provider: string, modelId: string) => Promise<boolean>
  /** 添加用户自定模型到指定 provider（创建 isHidden=false 的覆盖） */
  addUserModel: (form: Omit<ProviderModelOverrideForm, 'isHidden' | 'id'>) => Promise<ProviderModelOverrideRow | null>
  /** 更新一条覆盖记录（不适用于取消隐藏场景，那用 unhideBuiltin） */
  updateOverride: (form: ProviderModelOverrideForm) => Promise<ProviderModelOverrideRow | null>
  /** 删除一条覆盖记录 */
  deleteOverride: (id: string) => Promise<boolean>
}

export function useProviderModels(): UseProviderModelsReturn {
  const [overrides, setOverrides] = useState<ProviderModelOverrideRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const fetchOverrides = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/provider-models', { cache: 'no-store' })
      if (!res.ok) throw new Error(`加载失败（HTTP ${res.status}）`)
      const data = (await res.json()) as { providerOverrides: ProviderModelOverrideRow[] }
      setOverrides(data.providerOverrides || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOverrides()
  }, [fetchOverrides])

  // 查找指定 (provider, modelId) 的覆盖
  const findOverride = useCallback(
    (provider: string, modelId: string) =>
      overrides.find((o) => o.provider === provider && o.modelId === modelId),
    [overrides]
  )

  const postJSON = useCallback(async (path: string, body: unknown) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) {
      throw new Error(data.error || `请求失败（HTTP ${res.status}）`)
    }
    return data
  }, [])

  const deleteById = useCallback(async (id: string) => {
    const res = await fetch(`/api/provider-models?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) throw new Error(data.error || `删除失败（HTTP ${res.status}）`)
    return true
  }, [])

  const hideBuiltin = useCallback(
    async (provider: string, modelId: string, builtinName?: string) => {
      const existing = findOverride(provider, modelId)
      try {
        setError(null)
        if (existing) {
          // 已经存在覆盖 → 更新为 isHidden=true
          if (existing.isHidden) return true // 已经是隐藏状态
          setPendingId(existing.id)
          const updated = (await postJSON('/api/provider-models', {
            id: existing.id,
            provider,
            modelId,
            isHidden: true,
            name: '',
            contextWindow: existing.contextWindow,
            supportsVision: existing.supportsVision,
            supportsFiles: existing.supportsFiles,
            supportsReasoning: existing.supportsReasoning,
          })) as ProviderModelOverrideRow
          setOverrides((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
        } else {
          // 创建一条 isHidden=true 的覆盖
          const created = (await postJSON('/api/provider-models', {
            provider,
            modelId,
            isHidden: true,
            name: builtinName || modelId,
            contextWindow: 32768,
          })) as ProviderModelOverrideRow
          setOverrides((prev) => [...prev, created])
        }
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : '隐藏失败')
        return false
      } finally {
        setPendingId(null)
      }
    },
    [findOverride, postJSON]
  )

  const unhideBuiltin = useCallback(
    async (provider: string, modelId: string) => {
      const existing = findOverride(provider, modelId)
      if (!existing || !existing.isHidden) return false
      try {
        setError(null)
        setPendingId(existing.id)
        await deleteById(existing.id)
        setOverrides((prev) => prev.filter((o) => o.id !== existing.id))
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : '取消隐藏失败')
        return false
      } finally {
        setPendingId(null)
      }
    },
    [findOverride, deleteById]
  )

  const addUserModel = useCallback(
    async (form: Omit<ProviderModelOverrideForm, 'isHidden' | 'id'>) => {
      try {
        setError(null)
        setPendingId('__adding__')
        const created = (await postJSON('/api/provider-models', {
          ...form,
          isHidden: false,
        })) as ProviderModelOverrideRow
        setOverrides((prev) => [...prev, created])
        return created
      } catch (err) {
        setError(err instanceof Error ? err.message : '添加失败')
        return null
      } finally {
        setPendingId(null)
      }
    },
    [postJSON]
  )

  const updateOverride = useCallback(
    async (form: ProviderModelOverrideForm) => {
      if (!form.id) return null
      try {
        setError(null)
        setPendingId(form.id)
        const updated = (await postJSON('/api/provider-models', form)) as ProviderModelOverrideRow
        setOverrides((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
        return updated
      } catch (err) {
        setError(err instanceof Error ? err.message : '更新失败')
        return null
      } finally {
        setPendingId(null)
      }
    },
    [postJSON]
  )

  const deleteOverride = useCallback(
    async (id: string) => {
      try {
        setError(null)
        setPendingId(id)
        await deleteById(id)
        setOverrides((prev) => prev.filter((o) => o.id !== id))
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : '删除失败')
        return false
      } finally {
        setPendingId(null)
      }
    },
    [deleteById]
  )

  return {
    overrides,
    loading,
    error,
    pendingId,
    fetchOverrides,
    hideBuiltin,
    unhideBuiltin,
    addUserModel,
    updateOverride,
    deleteOverride,
  }
}
