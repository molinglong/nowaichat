import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { isEphemeralSession } from '@/lib/ephemeral'
import { listMcpToolInventory } from '@/lib/ai/mcp/mcp-client.server'
import { monitor } from '@/lib/monitor'

/**
 * GET /api/mcp/tools —— 输入框「MCP 工具」下拉菜单的数据源。
 * 返回用户全部 server（含停用）的工具清单（原始工具名 + excludeTools），
 * 由前端合并计算每个工具的开关态；开关写入走 PATCH /api/mcp/servers。
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // 临时会话（访客）：无 MCP 配置，返回空清单
  if (isEphemeralSession(session)) {
    return NextResponse.json({ servers: [] })
  }
  const servers = await listMcpToolInventory(session.user.id)
  monitor('mcp_tools_listed', {
    servers: servers.length,
    tools: servers.reduce((n, s) => n + s.tools.length, 0),
    failed: servers.filter((s) => s.error).length,
  })
  return NextResponse.json({ servers })
}
