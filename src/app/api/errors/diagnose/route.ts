import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { diagnoseUpstreamError } from "@/lib/ai/error-doctor"
import { ERROR_CODES, type UpstreamErrorCode } from "@/lib/error-catalog"

export const runtime = "nodejs"

/**
 * 「让 AI 分析原因」端点：只在用户主动点击时调用（零被动成本）。
 * 诊断用的 Key 一定不是出错那家（见 error-doctor 的 resolveDiagnoser）。
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "登录已失效，请重新登录后再试" }, { status: 401 })
  }

  let body: { raw?: unknown; code?: unknown; provider?: unknown; modelId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "请求体不是合法的 JSON" }, { status: 400 })
  }

  const raw = typeof body.raw === "string" ? body.raw.slice(0, 1000) : ""
  if (!raw) return NextResponse.json({ error: "缺少参数 raw" }, { status: 400 })

  const code = (ERROR_CODES.includes(body.code as UpstreamErrorCode) ? body.code : "unknown") as UpstreamErrorCode

  const { data, reason } = await diagnoseUpstreamError({
    userId,
    raw,
    code,
    provider: typeof body.provider === "string" ? body.provider.slice(0, 40) : undefined,
    modelId: typeof body.modelId === "string" ? body.modelId.slice(0, 80) : undefined,
  })

  if (!data) {
    const message =
      reason === 'rate_limited'
        ? "分析太频繁了，请 10 分钟后再试"
        : reason === 'all_failed'
          ? "手头的服务商 Key 都不能用于诊断（额度或鉴权问题），换个 Key 再试"
          : "没有可用于诊断的服务商 Key，请先到设置里配置任意一家"
    return NextResponse.json({ error: message, data: null }, { status: reason === "rate_limited" ? 429 : 200 })
  }
  return NextResponse.json({ data })
}
