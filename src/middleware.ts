import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"

// ── 临时聊天(访客模式):账户管理类端点统一拦截 ──────────────
// 临时模式(访客密码登录,token.ephemeral)下只保留"使用权":
// 模型调用/上传/生图/面具使用可用;一切账户管理写操作一律 403。
// 统一在 middleware 拦截,避免逐 handler 散布守卫造成遗漏。
const EPHEMERAL_DENIED_PREFIXES = [
  "/api/keys", // 模型 API Key 管理(含掩码明文头尾，防泄露；provider 名单用 /api/providers/keys-status 替代)
  "/api/search/keys", // 联网搜索 Key 管理
  "/api/settings", // AI 设置控制/澄清开关
  "/api/image-settings", // 生图设置
  "/api/provider-models", // 模型可见性管理/测试
  "/api/memories", // 长期记忆 CRUD(防删改污染)
  "/api/ephemeral", // 隔离区管理(找回/转正/删除)
  "/api/user/ephemeral-settings", // 访客密码/临时记忆开关
  "/api/study", // 学习功能(错题本/复习状态写入)
]

/** 方法敏感类：GET 等读操作放行，写操作拦截 */
const EPHEMERAL_METHOD_GUARDED: Array<[string, string[]]> = [
  ["/api/user/profile", ["PATCH", "POST", "PUT", "DELETE"]], // 改昵称等
  ["/api/masks", ["POST", "PATCH", "PUT", "DELETE"]], // 面具库写操作；GET 放行(选择器要用)
  ["/api/custom-models", ["POST", "PATCH", "PUT", "DELETE"]], // 自定义模型写操作；GET 放行(模型选择器要用，返回不含密钥明文)
  ["/api/images", ["DELETE", "PATCH", "PUT"]], // 图库删除；GET/POST(生图)放行
]

function isDeniedForEphemeral(pathname: string, method: string): boolean {
  if (
    EPHEMERAL_DENIED_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(p + "/")
    )
  ) {
    return true
  }
  return EPHEMERAL_METHOD_GUARDED.some(
    ([p, methods]) =>
      (pathname === p || pathname.startsWith(p + "/")) && methods.includes(method)
  )
}

export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET })
  const isLoggedIn = !!token
  const { pathname } = req.nextUrl

  // 临时模式统一拦截:命中账户管理类端点直接 403(与 handler 内守卫构成双保险)
  if (isLoggedIn && token.ephemeral === true && isDeniedForEphemeral(pathname, req.method)) {
    return NextResponse.json(
      { error: "临时聊天模式下不可修改账户设置" },
      { status: 403 }
    )
  }

  // 临时聊天模式页面级封锁:只允许聊天界面，
  // 手动输 URL 访问生图/探索/错题本页一律重定向回 /chat(API 已由上面的 403 拦截)
  if (isLoggedIn && token.ephemeral === true) {
    const pageDenied =
      pathname === "/images" || pathname.startsWith("/images/") ||
      pathname === "/explore" || pathname.startsWith("/explore/") ||
      pathname === "/study" || pathname.startsWith("/study/")
    if (pageDenied) {
      return NextResponse.redirect(new URL("/chat", req.url))
    }
  }

  // Public routes — always allow
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/test-toast"

  if (isPublic) {
    // Keep auth pages reachable so a stale JWT after a database restore can be replaced.
    return NextResponse.next()
  }

  // Protected routes — require auth
  if (!isLoggedIn) {
    // API 请求返回 401 JSON 而非重定向：fetchJson 客户端可识别 AuthorizationError 跳转登录页；
    // SSR/hydration 阶段的 fetch 不会携带 cookie，若重定向会拿到登录页 HTML 导致 JSON 解析失败
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    return NextResponse.redirect(new URL("/login", req.url))
  }

  return NextResponse.next()
}

export const config = {
  // 排除静态资源:uploads(字体/图片)不走 middleware,避免每个资源请求都执行 JWT 解码;
  // uploads 的安全头(X-Content-Type-Options/CSP sandbox)由 next.config.mjs headers() 独立提供,
  // 文件名 nanoid(12) 不可枚举,未登录直访风险可控
  matcher: ["/((?!_next/static|_next/image|favicon.ico|uploads).*)"],
}
