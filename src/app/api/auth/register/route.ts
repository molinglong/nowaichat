import { NextResponse } from "next/server"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"

const registerSchema = z.object({
  name: z.string().min(1, "用户名不能为空"),
  email: z.string().email("请输入有效的邮箱地址"),
  password: z.string().min(6, "密码长度至少为 6 位"),
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const result = registerSchema.safeParse(body)

    if (!result.success) {
      const firstError = result.error.issues[0]?.message ?? "输入无效"
      return NextResponse.json({ error: firstError }, { status: 400 })
    }

    const { name, email, password } = result.data

    const existing = await prisma.user.findUnique({
      where: { email },
    })

    if (existing) {
      return NextResponse.json(
        { error: "该邮箱已被注册" },
        { status: 409 }
      )
    }

    const passwordHash = await bcrypt.hash(password, 10)

    await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
      },
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (err) {
    console.error("[auth/register] failed:", err)
    if (err instanceof Error) {
      console.error("[auth/register] stack:", err.stack)
      console.error("[auth/register] message:", err.message)
      console.error("[auth/register] cause:", (err as Error & { cause?: unknown }).cause)
    }
    const message = err instanceof Error ? err.message : "unknown error"
    return NextResponse.json(
      { error: "服务器错误，请稍后重试", detail: message },
      { status: 500 }
    )
  }
}
