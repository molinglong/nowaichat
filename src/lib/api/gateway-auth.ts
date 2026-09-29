/**
 * 网关鉴权(部署级)——/api/v1/* 各端点共用。
 * 两级身份解析:
 * 1. 个人访问令牌:x-api-key → sha256 → ApiToken 表(未吊销)→ 绑定的 userId
 *    (aichatt 设置页「API 令牌」生成,可吊销;用户级隔离的根基)
 * 2. 部署级 env 令牌回退:AICHATT_API_TOKEN 匹配 → 视为管理员(库中首个用户),
 *    兼容早期部署;新接入一律走个人令牌。
 */
import { timingSafeEqual, createHash } from "node:crypto"
import { prisma } from "@/lib/db"

export function gatewayTokenOk(incoming: string): boolean {
  const expected = process.env.AICHATT_API_TOKEN?.trim()
  if (!expected || !incoming) return false
  const a = Buffer.from(incoming)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** anthropic 错误形状的 JSON 响应(与 /api/v1/messages 透传的上游错误同构) */
export function gatewayJsonError(status: number, type: string, message: string) {
  return new Response(JSON.stringify({ type: "error", error: { type, message } }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

export interface GatewayAuthRequest {
  headers: { get(name: string): string | null }
}

/**
 * 解析请求身份:x-api-key → ApiToken 表 → userId。
 * 解析不到时返回 null(调用方决定 401 还是回退)。
 */
export async function resolveGatewayUserId(
  req: GatewayAuthRequest
): Promise<string | null> {
  const incoming = req.headers.get("x-api-key")?.trim() ?? ""
  if (!incoming) return null

  const tokenHash = createHash("sha256").update(incoming).digest("hex")
  const record = await prisma.apiToken
    .findFirst({
      where: { tokenHash, revokedAt: null },
      select: { userId: true },
    })
    .catch(() => null)
  if (record) return record.userId

  const expected = process.env.AICHATT_API_TOKEN?.trim()
  if (expected && incoming.length === expected.length && timingSafeEqual(Buffer.from(incoming), Buffer.from(expected))) {
    const admin = await prisma.user.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    })
    return admin?.id ?? null
  }
  return null
}
