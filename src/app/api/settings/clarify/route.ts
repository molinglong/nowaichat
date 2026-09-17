import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

/**
 * 澄清提问开关(clarifyEnabled) —— 与 memories/settings 同构:
 * PATCH 切换,GET 查询。关闭后 chat route 不注入 ask_clarification 工具,
 * 模型直接回答,不再反问。
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { clarifyEnabled: true },
  })

  return NextResponse.json({ clarifyEnabled: user?.clarifyEnabled ?? true })
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
    data: { clarifyEnabled: body.enabled },
    select: { clarifyEnabled: true },
  })

  return NextResponse.json({ clarifyEnabled: user.clarifyEnabled })
}
