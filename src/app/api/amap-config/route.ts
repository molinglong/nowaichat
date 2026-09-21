import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { resolveAmapConfig } from "@/lib/amap-config.server"

/**
 * 下发高德 JS API 配置(登录态即可,临时会话访客也要能渲染行程地图)。
 * 设置页配置(AmapKey 表)优先,环境变量兜底 —— 页面换 Key 立即生效,无需改 env 重启。
 *
 * 只下发「Web端(JS API)」Key 与安全密钥 —— 这对值本就运行在浏览器,
 * 防盗用靠高德控制台的域名白名单(勿把 Web服务 Key(AMAP_WS_KEY)放进来,
 * 它只应在服务端做 POI 校准,且受 IP 白名单保护)。
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { jsKey, sec } = await resolveAmapConfig(session.user.id)
  if (!jsKey) {
    return NextResponse.json({ error: "地图服务未配置" }, { status: 404 })
  }
  return NextResponse.json({ key: jsKey, securityJsCode: sec || undefined })
}
