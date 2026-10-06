import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

const NAME_MAX_LENGTH = 20

const PROFILE_SELECT = {
  name: true,
  nickname: true,
  email: true,
  image: true,
  createdAt: true,
} as const

/** GET /api/user/profile - 当前登录用户资料（用户名/称呼/邮箱/头像/注册时间） */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: '登录已失效，请重新登录后再试' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: PROFILE_SELECT,
  })
  if (!user) {
    return NextResponse.json({ error: '用户不存在' }, { status: 404 })
  }
  return NextResponse.json(user)
}

/** PATCH /api/user/profile - 修改用户名（本期不做改密码/头像上传；称呼走 /api/profiles） */
export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: '登录已失效，请重新登录后再试' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体不是合法的 JSON' }, { status: 400 })
  }

  const name =
    typeof (body as { name?: unknown })?.name === 'string'
      ? (body as { name: string }).name.trim()
      : ''
  if (!name) {
    return NextResponse.json({ error: '用户名不能为空' }, { status: 400 })
  }
  if (name.length > NAME_MAX_LENGTH) {
    return NextResponse.json(
      { error: `用户名不能超过 ${NAME_MAX_LENGTH} 个字符` },
      { status: 400 }
    )
  }

  try {
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: { name },
      select: PROFILE_SELECT,
    })
    return NextResponse.json(user)
  } catch (err) {
    console.error('[user/profile] update failed:', err)
    return NextResponse.json({ error: '保存失败，请重试' }, { status: 500 })
  }
}
