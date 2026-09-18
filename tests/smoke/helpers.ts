import { config } from "dotenv"

// 冒烟测试账号:仓库公开,凭据不入库——从 .env 的 SMOKE_* 变量读取
config()

export const ADMIN = {
  id: process.env.SMOKE_ADMIN_ID ?? "admin",
  password: process.env.SMOKE_ADMIN_PASSWORD ?? "",
}

export const FULLTESTER = {
  id: process.env.SMOKE_FULLTESTER_ID ?? "",
  // 主密码与 admin 相同,仅用于验证"临时入口拒绝主密码"
  mainPassword: process.env.SMOKE_ADMIN_PASSWORD ?? "",
  guestPassword: process.env.SMOKE_FULLTESTER_GUEST ?? "",
}
