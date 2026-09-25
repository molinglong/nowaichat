import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { monitor } from "@/lib/monitor"

/**
 * AI 本地文件能力开关(localFilesEnabled) —— 与 clarify/memories 同构:
 * PATCH 切换,GET 查询。关闭后 chat route 不注入 local_file 工具(物理级关闭)。
 *
 * 该能力的实际执行只发生在桌面客户端(Tauri):前端仅在 Tauri 环境且开关开启时,
 * 才随请求上报 localFilesEnabled=true,服务端据此注入无 execute 的 local_file 工具,
 * 由客户端 onToolCall 拦截并在本地工作区沙箱内执行。
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { localFilesEnabled: true, localFilesExecAutoRun: true },
  })

  return NextResponse.json({
    localFilesEnabled: user?.localFilesEnabled ?? false,
    localFilesExecAutoRun: user?.localFilesExecAutoRun ?? false,
  })
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const hasEnabled = typeof body.enabled === "boolean"
  const hasExecAutoRun = typeof body.execAutoRun === "boolean"
  if (!hasEnabled && !hasExecAutoRun) {
    return NextResponse.json(
      { error: "enabled / execAutoRun 至少需要一个布尔值" },
      { status: 400 }
    )
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      ...(hasEnabled ? { localFilesEnabled: body.enabled } : {}),
      ...(hasExecAutoRun ? { localFilesExecAutoRun: body.execAutoRun } : {}),
    },
    select: { localFilesEnabled: true, localFilesExecAutoRun: true },
  })

  monitor("local_files_toggle", { enabled: user.localFilesEnabled, execAutoRun: user.localFilesExecAutoRun })

  return NextResponse.json({
    localFilesEnabled: user.localFilesEnabled,
    localFilesExecAutoRun: user.localFilesExecAutoRun,
  })
}
