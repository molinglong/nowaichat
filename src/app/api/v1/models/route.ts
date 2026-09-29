/**
 * 模型清单端点——外部 agent(如 ACode)登录流程用:
 * 凭个人访问令牌拉取该账号在 aichatt 配置的 anthropic 协议模型清单,
 * 客户端据此自动创建网关 provider 并填充模型列表。
 * CORS:ACode 渲染进程跨域拉取,x-api-key 令牌鉴权下 Allow-Origin: * 安全。
 */
import type { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { gatewayJsonError, resolveGatewayUserId } from "@/lib/api/gateway-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-api-key",
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(req: NextRequest) {
  const userId = await resolveGatewayUserId(req)
  if (!userId) {
    return new Response(JSON.stringify({ error: "invalid x-api-key" }), {
      status: 401,
      headers: { "content-type": "application/json", ...CORS },
    })
  }

  const rows = await prisma.customModel.findMany({
    where: { userId, protocol: "anthropic" },
    select: { modelId: true, name: true },
    orderBy: { createdAt: "asc" },
  })

  return Response.json(
    { models: rows.map((r) => ({ modelId: r.modelId, name: r.name })) },
    { headers: { ...CORS } }
  )
}
