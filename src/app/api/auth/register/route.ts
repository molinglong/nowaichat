import { NextResponse } from "next/server"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"

const registerSchema = z.object({
  name: z.string().min(1, "用户名不能为空"),
  email: z.string().email("请输入有效的邮箱地址"),
  password: z.string().min(6, "密码长度至少为 6 位"),
  code: z.string().min(1, "请输入注册码"),
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
    const code = result.data.code.trim().toUpperCase()

    // 注册邀请制:注册码「占用 + 建号」同事务原子完成,码不存在/停用/已用都拒绝
    // (防脚本批量注册烧公共池;一码一用,usedBy 记注册人)。
    const passwordHash = await bcrypt.hash(password, 10)

    try {
      await prisma.$transaction(async (tx) => {
        const rc = await tx.registerCode.findUnique({ where: { code } })
        if (!rc) throw new Error("注册码不存在，请核对后重试")
        if (!rc.enabled) throw new Error("该注册码已被停用")
        if (rc.usedBy) throw new Error("该注册码已被使用")

        const user = await tx.user.create({
          data: { name, email, passwordHash },
        })

        await tx.registerCode.update({
          where: { code },
          data: { usedBy: user.id, usedAt: new Date() },
        })
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : ""
      // 事务内的业务拒绝(码不存在/停用/已用)直接给文案;邮箱冲突在事务里会包一层,
      // 不含「注册码」字样的统一按已知错误/未知错误分类
      if (/注册码/.test(msg)) {
        return NextResponse.json({ error: msg }, { status: 400 })
      }
      if (/Unique constraint|该邮箱已被注册/i.test(msg) || msg.includes("email")) {
        return NextResponse.json({ error: "该邮箱已被注册" }, { status: 409 })
      }
      console.error("[auth/register] transaction failed:", err)
      return NextResponse.json({ error: "注册失败，请稍后重试" }, { status: 500 })
    }

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
