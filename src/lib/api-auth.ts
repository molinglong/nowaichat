import { createHash } from "crypto"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

/**
 * API 鉴权双通道 —— cookie session 与 Bearer Token 统一入口。
 *
 * Bearer 通道: 外部静态页面(新标签页 bento 等)无 NextAuth cookie，用
 * Authorization: Bearer <token> 调 REST API。token 明文经 sha256 后查
 * ApiToken 表(见 schema)，revokedAt 为空才有效。
 *
 * 决策：带了显式 Bearer 却无效时直接返回 null(401)，不降级到 cookie ——
 * 无效凭证应明确拒绝，避免「token 无效却借到 cookie 权限」的歧义。
 *
 * 注意：本模块含 prisma，只能在 node runtime 的 route handler 内使用；
 * middleware(edge runtime) 只负责透传 Authorization 头，不做表查询。
 */

export async function getUserId(req: Request): Promise<string | null> {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (bearer) {
    const tokenHash = createHash("sha256").update(bearer).digest("hex")
    const record = await prisma.apiToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, revokedAt: true },
    })
    if (record && !record.revokedAt) {
      // 回写最近使用时间：审计用，失败不影响主流程
      prisma.apiToken
        .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {})
      return record.userId
    }
    return null
  }

  const session = await auth()
  return session?.user?.id ?? null
}
