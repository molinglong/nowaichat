import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

interface Params {
  params: { id: string }
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const memory = await prisma.memory.findUnique({
    where: { id: params.id },
    select: { userId: true },
  })

  if (!memory || memory.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await prisma.memory.delete({ where: { id: params.id } })
  return NextResponse.json({ success: true })
}
