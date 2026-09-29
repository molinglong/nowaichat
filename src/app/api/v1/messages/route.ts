/**
 * Anthropic Messages 兼容端点(透明代理)——让外部 agent(如 ACode)以 aichatt 为唯一模型网关。
 *
 * 鉴权:x-api-key → 个人访问令牌(ApiToken 表)解析出 userId,或部署级 env 令牌回退(管理员)。
 * 隔离:模型解析按该用户的 CustomModel 行匹配——每个 aichatt 账号只能走自己配置的模型。
 * 转发:resolveApiKey 解密该行 key,原样转发到 {normalized baseURL}/messages,
 *       响应(含 SSE 流)逐字节透传。
 * 为什么是透明代理而不是协议翻译:ACode 说 anthropic 协议,中转站也说 anthropic 协议,
 * aichatt 只做「key 保险箱 + 地址映射」——工具调用/流式事件零改动全保留,
 * 中转站原始 key 从此只存在 aichatt 一处。
 */
import type { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { resolveApiKey, normalizeCustomBaseURL } from "@/lib/ai/custom-model"
import { gatewayJsonError, resolveGatewayUserId } from "@/lib/api/gateway-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** 连通性自检(不暴露任何敏感信息;与 401 的区别仅在于不用带 token) */
export async function GET() {
  return Response.json({ ok: true, service: "aichatt-anthropic-proxy" })
}

export async function POST(req: NextRequest) {
  const userId = await resolveGatewayUserId(req)
  if (!userId) {
    return gatewayJsonError(401, "authentication_error", "invalid x-api-key")
  }

  let body: unknown = null
  try {
    body = await req.json()
  } catch {
    return gatewayJsonError(400, "invalid_request_error", "invalid JSON body")
  }
  const model =
    typeof body === "object" && body !== null && "model" in body
      ? (body as { model?: unknown }).model
      : undefined
  if (typeof model !== "string" || !model) {
    return gatewayJsonError(400, "invalid_request_error", "missing model")
  }

  const cm = await prisma.customModel.findFirst({
    where: { modelId: model, protocol: "anthropic", userId },
  })
  if (!cm) {
    return gatewayJsonError(404, "not_found_error", `no anthropic-protocol custom model named "${model}"`)
  }

  const apiKey = await resolveApiKey(cm.userId, cm).catch(() => undefined)
  const base = normalizeCustomBaseURL(cm.baseURL)
  if (!base) {
    return gatewayJsonError(500, "api_error", "custom model has no baseURL")
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": apiKey && apiKey.trim() !== "" ? apiKey : "local",
    "anthropic-version": req.headers.get("anthropic-version") ?? "2023-06-01",
  }
  const beta = req.headers.get("anthropic-beta")
  if (beta) headers["anthropic-beta"] = beta

  const upstream = await fetch(`${base}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })

  // 逐字节透传(含 SSE 流);上游错误(401/429/5xx)同样原样转交,客户端按 anthropic 错误格式处理
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  })
}
