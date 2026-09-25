import { NextResponse } from "next/server"
import { getUserId } from "@/lib/api-auth"
import { prisma } from "@/lib/db"

/**
 * 代码文档列表(按会话) —— 独立于写作画布的代码编辑器数据层。
 * 单篇读写删见 /api/code/docs/[id];正文即代码文本,language 标识语言。
 *
 * 列表只服务于「当前对话的 AI 代码产物」:必须带 conversationId 且校验会话
 * 归属(防越权窥探他人会话产物)。新建不再开放——代码文档由 write_code 工具
 * 在聊天中产生,手动新建入口已移除。
 *
 * 鉴权:双通道(lib/api-auth)—— cookie session 与 Bearer Token 均可。
 */

export async function GET(req: Request) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const conversationId = new URL(req.url).searchParams.get("conversationId")
  if (!conversationId) {
    return NextResponse.json({ error: "缺少 conversationId" }, { status: 400 })
  }
  // 归属校验:会话不属于当前用户时按空列表处理(不泄露存在性)
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  })
  if (!conv) {
    return NextResponse.json({ docs: [] })
  }

  // 列表不取 content(代码文件可能很长),字数看冗余的 charCount
  const docs = await prisma.codeDoc.findMany({
    where: { userId, conversationId },
    select: {
      id: true,
      title: true,
      language: true,
      charCount: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  })

  return NextResponse.json({ docs })
}
