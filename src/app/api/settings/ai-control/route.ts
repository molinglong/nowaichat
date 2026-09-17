import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

/**
 * AI 设置控制总开关(aiSettingsControl) —— 与 settings/clarify 同构:
 * PATCH 切换,GET 查询。关闭后 chat route 不注入 update_settings 工具与设置快照段
 * （物理级关闭）,改注入降级提示。
 *
 * 安全边界:本字段刻意不在 AI 可控注册表(src/lib/settings/registry.ts)内,
 * AI 的全部出口(工具枚举、前端执行器)均不包含该 key,只能在此手动修改。
 * GET 仅只读、仅 PATCH 写入,无任何 GET 写路径,防 CSRF 式旁路。
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { aiSettingsControl: true },
  })

  return NextResponse.json({ aiSettingsControl: user?.aiSettingsControl ?? true })
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled 必须是布尔值" }, { status: 400 })
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: { aiSettingsControl: body.enabled },
    select: { aiSettingsControl: true },
  })

  return NextResponse.json({ aiSettingsControl: user.aiSettingsControl })
}
