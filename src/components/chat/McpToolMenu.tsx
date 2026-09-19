'use client'

/**
 * MCP 工具下拉菜单（聊天输入框「MCP 工具」胶囊弹出）：
 * - 顶部会话总开关（mcpEnabled，localStorage 持久化，控制本次会话是否注入 MCP）
 * - 按 server 分组的工具清单：逐工具开关（写入 DB excludeTools，与设置页同源全局生效）
 * - server 级启停开关（PATCH enabled）；停用分组不连接、工具开关禁用
 * 数据源：GET /api/mcp/tools（连接拉取工具清单）+ GET /api/mcp/servers（server 列表，共享缓存）
 * 遮罩/开合由本组件自带（fixed 遮罩 + absolute 弹层，对齐面具菜单模式）。
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, TriangleAlert } from 'lucide-react'
import { fetchJson, HttpError } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { MiniSwitch } from '@/components/settings/MiniSwitch'

interface ServerInventoryDTO {
  id: string
  name: string
  enabled: boolean
  excludeTools: string[]
  tools: Array<{ name: string; description?: string }>
  error?: string
}

function errText(e: unknown): string {
  if (e instanceof HttpError) return e.message
  if (e instanceof Error) return e.message
  return '操作失败'
}

export function McpToolMenu({
  mcpEnabled,
  onMcpEnabledChange,
  onClose,
}: {
  mcpEnabled: boolean
  onMcpEnabledChange: (enabled: boolean) => void
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [busyTool, setBusyTool] = useState<string | null>(null) // `${id}:${toolName}`
  const [busyServer, setBusyServer] = useState<string | null>(null)

  // 工具清单:菜单打开即拉取(连接各 server,5s 超时,短缓存)
  const { data, isLoading } = useQuery<{ servers: ServerInventoryDTO[] }>({
    queryKey: queryKeys.mcp.tools(),
    queryFn: () => fetchJson('/api/mcp/tools'),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const servers = data?.servers ?? []

  async function invalidateMcp() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.tools() }),
    ])
  }

  /** 工具开关 = 反向维护 excludeTools(勾掉的工具不再注入) */
  async function toggleTool(server: ServerInventoryDTO, toolName: string) {
    const key = `${server.id}:${toolName}`
    setBusyTool(key)
    try {
      const excluded = server.excludeTools.includes(toolName)
      const next = excluded
        ? server.excludeTools.filter((t) => t !== toolName)
        : [...server.excludeTools, toolName]
      await fetchJson('/api/mcp/servers', {
        method: 'PATCH',
        json: { id: server.id, excludeTools: next },
      })
      await invalidateMcp()
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusyTool(null)
    }
  }

  async function toggleServer(server: ServerInventoryDTO) {
    setBusyServer(server.id)
    try {
      await fetchJson('/api/mcp/servers', {
        method: 'PATCH',
        json: { id: server.id, enabled: !server.enabled },
      })
      await invalidateMcp()
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusyServer(null)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-50 w-80
          rounded-xl border border-line bg-surface shadow-lg"
        role="menu"
      >
        {/* 头部:会话总开关 */}
        <div className="flex items-center justify-between border-b border-line/60 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-xs font-medium text-content-primary">MCP 工具</p>
            <p className="text-[10px] text-content-muted">{mcpEnabled ? '本会话注入外部工具' : '本会话已停用'}</p>
          </div>
          <MiniSwitch on={mcpEnabled} onClick={() => onMcpEnabledChange(!mcpEnabled)} />
        </div>

        {/* server 分组 + 工具清单 */}
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-content-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : servers.length === 0 ? (
          <p className="px-3 py-5 text-center text-[11px] text-content-muted">
            还没有可用的 MCP 服务，请在设置 → MCP 工具中添加
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto py-1">
            {servers.map((server) => (
              <div key={server.id} className="px-3 py-1.5">
                {/* 分组头:server 名 + 启停 */}
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[11px] font-medium text-content-secondary">
                    {server.name}
                  </span>
                  {busyServer === server.id ? (
                    <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-content-muted" />
                  ) : (
                    <MiniSwitch on={server.enabled} onClick={() => toggleServer(server)} />
                  )}
                </div>
                {server.error ? (
                  <p className="mt-0.5 flex items-center gap-1 text-[10px] text-red-500">
                    <TriangleAlert className="h-3 w-3 shrink-0" />
                    <span className="truncate" title={server.error}>{server.error}</span>
                  </p>
                ) : !server.enabled ? (
                  <p className="mt-0.5 text-[10px] text-content-muted">已停用，工具不注入</p>
                ) : server.tools.length === 0 ? (
                  <p className="mt-0.5 text-[10px] text-content-muted">该服务未提供工具</p>
                ) : (
                  <div className="mt-0.5 space-y-px">
                    {server.tools.map((t) => {
                      const on = !server.excludeTools.includes(t.name)
                      const key = `${server.id}:${t.name}`
                      return (
                        <div
                          key={t.name}
                          className={cn(
                            'flex items-center gap-2 rounded-md py-1 pl-1.5 pr-2 transition-colors hover:bg-surface-subtle',
                            (!server.enabled || !mcpEnabled) && 'opacity-60'
                          )}
                        >
                          <span className="min-w-0 flex-1" title={t.description || t.name}>
                            <span className="block truncate font-mono text-[10px] text-content-secondary">
                              {t.name}
                            </span>
                            {t.description && (
                              <span className="block truncate text-[9px] text-content-muted">
                                {t.description}
                              </span>
                            )}
                          </span>
                          {busyTool === key ? (
                            <Loader2 className="w-3 h-3 shrink-0 animate-spin text-content-muted" />
                          ) : (
                            <MiniSwitch
                              on={on}
                              disabled={!server.enabled}
                              onClick={() => toggleTool(server, t.name)}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="border-t border-line/60 px-3 py-1.5 text-[9px] leading-relaxed text-content-muted">
          工具开关全局生效（与设置页同步）；顶部开关仅控制本会话是否注入。
        </p>
      </div>
    </>
  )
}
