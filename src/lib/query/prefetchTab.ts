import type { QueryClient } from '@tanstack/react-query'
import { queryKeys, STALE, IMAGES_PAGE_SIZE } from '@/lib/query/keys'
import { fetchJson } from '@/lib/query/fetcher'
import { providersModelsQuery } from '@/lib/query/providers'
import type { ModelDefinition } from '@/lib/ai/types'

export type TabKey = 'chat' | 'images' | 'explore' | 'write'

/**
 * ── Tab 数据预热 ────────────────────────────────────────
 * 用户点 tab 之前已经在某些场景下耗时地下载 JS chunk / 拉数据。
 * 提前 prefetch 让切到目标页时 useQuery 走 cache 同步命中,不再 spinner。
 *
 * 从 TopBar 抽出共享:移动端 BottomDock 的点击预热走同一份实现。
 *
 * 关键点:
 * 1. hover 也触发 — 桌面端用户在鼠标进入 tab 的瞬间就把数据备好
 * 2. 每个 tab 都有自己要用的 query key(列表分别预热),不滥用
 * 3. 与 router.prefetch 互补:router prefetch 是下载 RSC chunk,
 *    queryClient.prefetchQuery 是拉服务端数据,二者缺一不可
 */
export function prefetchTabData(queryClient: QueryClient, tab: TabKey) {
  // 所有 tab 都会用到 providers — 总是预热(映射收敛于 providersModelsQuery,
  // 勿在此内联重写:曾因这里的副本漏字段导致 /chat 首跑默认模型选不中)
  queryClient.prefetchQuery(providersModelsQuery)

  // /chat 新对话页 + /chat/c/[id] 都需要 models — providers 已经覆盖
  // 已有会话的内容由 React Query 的 staleTime(10s)自动管理,不强 prefetch

  if (tab === 'images') {
    // 生图历史列表:生图页主体用本地 state 渲染、首次挂载必拉接口。
    // 这里预热首页数据(生图页拉完也会写回同一 key),切到生图页时
    // 直接从缓存同步回填,不再主区空白 1.5s。
    queryClient.prefetchQuery({
      queryKey: queryKeys.images.list(IMAGES_PAGE_SIZE, 0),
      queryFn: () =>
        fetchJson<{ items?: unknown[]; total?: number }>(
          `/api/images?limit=${IMAGES_PAGE_SIZE}&offset=0`
        ),
      staleTime: STALE.images,
    })

    queryClient.prefetchQuery({
      queryKey: queryKeys.images.settings(),
      queryFn: () =>
        fetchJson<{
          settings?: { imageModel?: string; imageSize?: string }
          builtinModels?: Array<Record<string, unknown>>
          customModels?: Array<Record<string, unknown>>
        }>('/api/image-settings'),
      staleTime: STALE.imageSettings,
    })
  }

  if (tab === 'explore') {
    queryClient.prefetchQuery({
      queryKey: queryKeys.customModels(),
      queryFn: () =>
        fetchJson<ModelDefinition[] | { items?: ModelDefinition[] }>(
          '/api/custom-models'
        ).then((d) => (Array.isArray(d) ? d : d?.items ?? [])),
      staleTime: STALE.customModels,
    })
  }
}
