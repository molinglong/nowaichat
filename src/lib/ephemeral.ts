import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'

// ── 临时聊天(访客模式)服务端隔离工具 ─────────────────────────
// 隔离在 API 层强制执行,前端标识仅为提示;模式由 session.ephemeral
// (访客密码登录时写入 JWT)决定,前端无法伪造。

/**
 * 当前会话是否为临时聊天模式。
 * 临时模式 = 访客密码登录产生(JWT 带 ephemeral 标记)。
 */
export function isEphemeralSession(session: Session | null): boolean {
  return session?.ephemeral === true
}

/**
 * 会话隔离过滤条件:临时会话只能触达 isEphemeral=true 的对话,
 * 正常会话只能触达 isEphemeral=false 的对话(防 id 直达穿透)。
 * 用法: where: { userId, ...ephemeralScope(session) }
 */
export function ephemeralScope(session: Session | null): { isEphemeral: boolean } {
  return { isEphemeral: isEphemeralSession(session) }
}

/**
 * 敏感端点统一守卫:临时模式下返回 403 响应,否则返回 null 放行。
 * 用法:
 *   const denied = denyIfEphemeral(session)
 *   if (denied) return denied
 * 适用:密码/API Key/访客密码/记忆等账户管理类写操作;
 * 使用类资源(模型调用、上传、面具使用)不在其列。
 */
export function denyIfEphemeral(session: Session | null): NextResponse | null {
  if (isEphemeralSession(session)) {
    return NextResponse.json(
      { error: '临时聊天模式下不可修改账户设置' },
      { status: 403 }
    )
  }
  return null
}
