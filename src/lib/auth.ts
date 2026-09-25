import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { prisma } from "./db"
import { monitor } from "@/lib/monitor"

// ── 临时聊天(访客模式)常量 ──────────────────────────────
/** 临时会话(访客密码登录)的 JWT 有效期:12 小时,公共电脑场景自动过期 */
const EPHEMERAL_SESSION_MAX_AGE_S = 12 * 60 * 60

/** 临时登录入口收到主密码时抛出的专属错误:前端据 code 显示定向提示 */
class GuestPasswordRequiredError extends CredentialsSignin {
  code = "EPHEMERAL_ENTRY_MAIN_PASSWORD"
}

/** 登录限速触发时抛出的错误:前端据 code 提示稍后再试 */
class RateLimitedError extends CredentialsSignin {
  code = "RATE_LIMITED"
}

// ── 登录失败限速:同一 identifier 1 分钟窗口内最多 5 次失败 ──
// 防爆破访客密码后蹭 API 额度;内存级实现,进程重启即清零(可接受)
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_FAILURES = 5
const loginFailures = new Map<string, { count: number; resetAt: number }>()

function loginRateLimited(identifier: string): boolean {
  const entry = loginFailures.get(identifier)
  if (!entry || entry.resetAt < Date.now()) return false
  return entry.count >= RATE_LIMIT_MAX_FAILURES
}

function recordLoginFailure(identifier: string): void {
  const now = Date.now()
  const entry = loginFailures.get(identifier)
  if (!entry || entry.resetAt < now) {
    // 简单防 Map 膨胀:超过 1000 个 identifier 时清掉已过期窗口
    if (loginFailures.size > 1000) {
      loginFailures.forEach((v, k) => {
        if (v.resetAt < now) loginFailures.delete(k)
      })
    }
    loginFailures.set(identifier, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return
  }
  entry.count += 1
  monitor("login_failed", { identifier })
}

function clearLoginFailures(identifier: string): void {
  loginFailures.delete(identifier)
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // 临时登录入口(/login/ephemeral)传入:该入口只认访客密码,拒绝主密码
        ephemeralEntry: { label: "Ephemeral Entry", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        // 登录标识兼容邮箱与用户名:先按 email 查,查不到再按 name 兑底
        const identifier = credentials.email as string
        const rateLimitKey = identifier.toLowerCase()
        if (loginRateLimited(rateLimitKey)) {
          monitor("login_rate_limited", { identifier: rateLimitKey })
          throw new RateLimitedError()
        }

        const user =
          (await prisma.user.findUnique({
            where: { email: identifier },
          })) ??
          (await prisma.user.findFirst({
            where: { name: identifier },
          }))

        if (!user) {
          recordLoginFailure(rateLimitKey)
          return null
        }

        const password = credentials.password as string
        // 临时入口标志:仅 /login/ephemeral 提交时为真
        const ephemeralEntry =
          credentials.ephemeralEntry === "1" || credentials.ephemeralEntry === "true"

        // 1) 主密码优先比对 → 完整模式
        if (user.passwordHash && (await bcrypt.compare(password, user.passwordHash))) {
          // 临时入口拒绝主密码:防止在公共电脑误输主密码造成泄露
          if (ephemeralEntry) {
            monitor("login_ephemeral_entry_main_password", { identifier: rateLimitKey })
            throw new GuestPasswordRequiredError()
          }
          clearLoginFailures(rateLimitKey)
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
          }
        }

        // 2) 访客密码比对 → 临时模式(guestPasswordHash 为空=未启用,永不命中)
        if (
          user.guestPasswordHash &&
          (await bcrypt.compare(password, user.guestPasswordHash))
        ) {
          clearLoginFailures(rateLimitKey)
          monitor("login_guest_ok", { identifier: rateLimitKey })
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            ephemeral: true,
          }
        }

        recordLoginFailure(rateLimitKey)
        return null
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id
        token.sub = user.id  // explicitly set sub for reliability
        // 临时模式标记:访客密码登录产生;同时把临时会话有效期压到 12h
        token.ephemeral = (user as { ephemeral?: boolean }).ephemeral === true
        if (token.ephemeral) {
          token.exp = Math.floor(Date.now() / 1000) + EPHEMERAL_SESSION_MAX_AGE_S
          // 透出给前端的真实过期时间(毫秒):session.expires 是全局 maxAge(30 天),
          // 不反映临时会话的 12h 压缩有效期
          token.sessionEndsAt = token.exp * 1000
        }
      }
      // 客户端 useSession().update({ name }) 时把新昵称写入 token,
      // 否则 JWT 策略下侧边栏等处会一直显示登录时固化的旧资料
      if (trigger === 'update' && session?.name) {
        token.name = session.name
      }
      return token
    },
    async session({ session, token }) {
      const userId = (token.sub ?? token.id) as string | undefined
      if (!userId || !session.user) return session

      session.user.id = userId
      // 透出临时模式标记:服务端 API 隔离与前端 UI 均以此为准
      session.ephemeral = token.ephemeral === true
      if (typeof token.sessionEndsAt === 'number') {
        session.sessionEndsAt = token.sessionEndsAt
      }
      return session
    },
  },
})
