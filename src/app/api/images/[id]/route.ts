import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { sanitizeUploadName, deleteUploadFile } from "@/lib/uploads"

/**
 * DELETE /api/images/[id]
 * 删除当前用户的一张生图记录。
 * 默认同时删除磁盘上的文件(若文件名符合上传规范);
 * 可通过 ?keepFile=1 保留文件(例如从对话历史中仍被引用)。
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id
  const { id } = await params

  const record = await prisma.generatedImage.findFirst({
    where: { id, userId },
    select: { id: true, url: true },
  })
  if (!record) {
    return NextResponse.json({ error: "记录不存在" }, { status: 404 })
  }

  await prisma.generatedImage.delete({ where: { id: record.id } })

  const { searchParams } = new URL(req.url)
  const keepFile = searchParams.get("keepFile") === "1"
  if (!keepFile) {
    // url 形如 /uploads/wanx-xxx.png,提取文件名后尝试删除
    const filename = record.url.split("/").pop() ?? ""
    const safe = sanitizeUploadName(filename)
    if (safe) {
      await deleteUploadFile(safe).catch(() => {
        // 文件不存在也忽略(避免阻塞 API)
      })
    }
  }

  return NextResponse.json({ success: true })
}
