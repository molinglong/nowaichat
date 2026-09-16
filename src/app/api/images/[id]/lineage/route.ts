import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

/**
 * GET /api/images/[id]/lineage
 * 沿着 parentId 链向上取所有祖先图,用于显示「基于 X 修改」面包屑。
 * 返回的数组按 根→...→当前 的顺序排列。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id
  const { id } = await params

  const chain: { id: string; url: string; prompt: string; createdAt: Date; editType: string }[] = []
  const visited = new Set<string>()
  let currentId: string | null = id

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const node: { id: string; parentId: string | null; url: string; prompt: string; createdAt: Date; editType: string; userId: string } | null =
      await prisma.generatedImage.findUnique({
        where: { id: currentId },
        select: {
          id: true,
          parentId: true,
          url: true,
          prompt: true,
          createdAt: true,
          editType: true,
          userId: true,
        },
      })
    if (!node || node.userId !== userId) break
    chain.push({
      id: node.id,
      url: node.url,
      prompt: node.prompt,
      createdAt: node.createdAt,
      editType: node.editType,
    })
    currentId = node.parentId
  }

  // 反转:根 → 当前
  return NextResponse.json({ chain: chain.reverse() })
}
