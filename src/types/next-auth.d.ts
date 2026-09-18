import type { DefaultSession } from "next-auth"

// 临时聊天(访客模式)类型扩展:
// - Session.ephemeral:当前会话是否为临时模式(访客密码登录产生),
//   服务端 API 隔离与前端 UI 均以此为准
// - User.ephemeral:authorize 凭据校验通过时附加的临时模式标记
// - JWT.ephemeral:token 上的临时标记;id 沿用项目现有用法
declare module "next-auth" {
  interface Session {
    ephemeral?: boolean
    /** 临时会话的真实过期时间(毫秒时间戳);仅 ephemeral 会话有值,供剩余时长展示 */
    sessionEndsAt?: number
    user?: DefaultSession["user"] & { id?: string }
  }

  interface User {
    ephemeral?: boolean
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    ephemeral?: boolean
    /** 临时会话过期时间(毫秒),透出到 Session.sessionEndsAt */
    sessionEndsAt?: number
    id?: string
  }
}
