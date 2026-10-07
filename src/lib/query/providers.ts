import { queryKeys, STALE } from '@/lib/query/keys'
import { fetchJson } from '@/lib/query/fetcher'
import type { ModelDefinition } from '@/lib/ai/types'

/**
 * ── /api/providers 模型列表的唯一 queryFn ─────────────────
 * 历史上 TopBar 预热(prefetchTab)、/chat、/study、/write、/chat/c/[id]
 * 各自手写映射,字段清单漂移 —— publicPool 透传缺失导致「标准」模型的
 * 首跑默认选不中。收敛到这一份:模型级扩展字段经展开透传自动携带,
 * 以后给 ModelDefinition 加字段只改 /api/providers 即可,调用点零改动。
 */
export const providersModelsQuery = {
  queryKey: queryKeys.providers(),
  queryFn: async (): Promise<ModelDefinition[]> => {
    const payload = await fetchJson<
      | Array<{ id?: string; effectiveModels: Array<Omit<ModelDefinition, 'provider'> & { provider?: string }> }>
      | { providers: Array<{ id?: string; effectiveModels: Array<Omit<ModelDefinition, 'provider'> & { provider?: string }> }> }
    >('/api/providers')
    const list = Array.isArray(payload) ? payload : payload.providers ?? []
    return list.flatMap((p) =>
      (p.effectiveModels ?? []).map((m) => ({
        ...m,
        provider: p.id ?? m.provider ?? '',
      }))
    )
  },
  staleTime: STALE.providers,
}
