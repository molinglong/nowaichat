import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

/**
 * GET /api/providers/keys-status
 * 返回当前用户已配置 Key 的 provider 名单（仅 provider 标识，无任何密钥信息）。
 *
 * 用途:模型选择器需要知道"哪些 provider 可选"(有 Key 才展示其模型)。
 * 临时聊天模式下 /api/keys 整体 403(防掩码泄露),故提供本端点作为
 * 零敏感信息的替代数据源——临时模式天然放行(不在 middleware 拦截列表)。
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const keys = await prisma.apiKey.findMany({
    where: { userId: session.user.id },
    select: { provider: true },
  })

  return NextResponse.json(keys)
}
