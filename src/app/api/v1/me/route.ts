/**
 * 网关身份端点——令牌 → 该 aichatt 账号的资料(email/name)。
 * ACode 令牌登录后调用,用于在桌面端账号区显示 aichatt 身份。
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
    return gatewayJsonError(401, "authentication_error", "invalid x-api-key")
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  })
  if (!user) {
    return gatewayJsonError(404, "not_found_error", "user not found")
  }

  return Response.json(
    { userId: user.id, email: user.email, name: user.name ?? user.email },
    { headers: { ...CORS } }
  )
}
