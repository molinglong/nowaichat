import { NextResponse } from "next/server"
import { getUserId } from "@/lib/api-auth"
import { prisma } from "@/lib/db"
import { normalizeWriteContent, normalizeWriteTitle } from "@/lib/write/doc-input"

/**
 * 写作文档 CRUD(列表/新建) —— 豆包式「帮我写作」工作区(/write)的数据层。
 * 单篇读写删见 /api/write/docs/[id];正文生成走 /api/write/generate(流式)。
 *
 * 鉴权:双通道(lib/api-auth)—— cookie session 与 Bearer Token 均可,
 * 与 /api/todos 同规则;所有查询都按 userId 过滤,防越权。
 */

export async function GET(req: Request) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // 列表不取 content(可能是几万字的长文),字数看冗余的 charCount
  const docs = await prisma.writeDoc.findMany({
    where: { userId },
    select: {
      id: true,
      title: true,
      charCount: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  })

  return NextResponse.json({ docs })
}

export async function POST(req: Request) {
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  let content = ""
  if (body.content !== undefined) {
    const c = normalizeWriteContent(body.content)
    if (c === null) {
      return NextResponse.json({ error: "正文为空或超出长度上限" }, { status: 400 })
    }
    content = c
  }

  const doc = await prisma.writeDoc.create({
    data: {
      userId,
      title: normalizeWriteTitle(body.title),
      content,
      charCount: content.length,
    },
    // 新建后前端立即进入编辑器,列表项用不到全文
    select: {
      id: true,
      title: true,
      charCount: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return NextResponse.json(doc, { status: 201 })
}
