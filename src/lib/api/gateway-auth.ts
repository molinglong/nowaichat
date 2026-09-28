/**
 * 网关令牌鉴权(部署级全局令牌)——/api/v1/* 各端点共用。
 * 令牌配在 .env 的 AICHATT_API_TOKEN,客户端经 x-api-key 头携带,时序安全比对。
 */
import { timingSafeEqual } from "node:crypto"

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
