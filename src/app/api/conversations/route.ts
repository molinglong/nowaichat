import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { STYLE_PRESETS } from '@/lib/ai/style-presets'
import { getMaskById } from '@/lib/ai/mask-resolve'

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 限量分页: ?limit=20&offset=0,limit 上限 100;?q=关键词支持按标题搜索
  const { searchParams } = new URL(req.url)
  const parsedLimit = parseInt(searchParams.get('limit') ?? '20', 10)
  const parsedOffset = parseInt(searchParams.get('offset') ?? '0', 10)
  const limit = Math.min(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20, 100)
  const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0
  const q = (searchParams.get('q') ?? '').trim()

  // 搜索范围:
  //   ?q=关键词 不为空时,匹配标题(title)或任意一条消息的内容(content);
  //   标题匹配优先,消息匹配次之。两者均使用 case-insensitive 搜索,
  //   并依靠 Message.content 上的 pg_trgm GIN 索引(见对应迁移)加速。
  //   ?type=title 仅按标题过滤(供"仅标题"模式备用)。
  const type = (searchParams.get('type') ?? '').trim().toLowerCase()
  // 面具筛选:'none' 表示无面具;其余值按原始 maskId 精确匹配(内置裸 id / user:<cuid>)。
  // 与 q 关键词为 AND 关系;只传筛选不传 q 时等于浏览该面具的全部对话。
  const maskFilter = (searchParams.get('maskId') ?? '').trim()
  const where = {
    userId: session.user.id,
    ...(maskFilter
      ? maskFilter === 'none'
        ? { maskId: null }
        : { maskId: maskFilter }
      : {}),
    ...(q
      ? type === 'title'
        ? { title: { contains: q, mode: 'insensitive' as const } }
        : {
            OR: [
              { title: { contains: q, mode: 'insensitive' as const } },
              {
                messages: {
                  some: {
                    content: { contains: q, mode: 'insensitive' as const },
                  },
                },
              },
            ],
          }
      : {}),
  }

  const [total, conversations] = await Promise.all([
    prisma.conversation.count({ where }),
    prisma.conversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        model: true,
        mode: true,
        maskId: true, // 列表尾随面具徽标用(ConversationItem)
        updatedAt: true,
      },
      skip: offset,
      take: limit,
    }),
  ])

  return NextResponse.json({
    items: conversations,
    total,
    hasMore: offset + conversations.length < total,
  })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))

  // 另存为新对话: 从对比会话克隆(用户消息 + 所选模型的回答)
  if (body.cloneFrom) {
    const source = await prisma.conversation.findFirst({
      where: { id: body.cloneFrom, userId: session.user.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
    if (!source) {
      return NextResponse.json({ error: 'Source conversation not found' }, { status: 404 })
    }
    const targetModel = body.model || source.model
    // 纯单聊消息(无 groupId)全部保留;对比泳道消息仅保留所选模型
    const cloneMessages = source.messages.filter(
      (m) => m.role === 'user' || m.groupId == null || m.model === targetModel
    )
    const conversation = await prisma.conversation.create({
      data: {
        userId: session.user.id,
        title: body.title || source.title || '新对话',
        model: targetModel,
        styleOffset: source.styleOffset,
        stylePreset: source.stylePreset, // 克隆时一并继承 preset(可能为 null,表示走 balanced)
        maskId: source.maskId, // 克隆时一并继承面具(可能为 null)
        messages: {
          create: cloneMessages.map((m) => ({
            role: m.role,
            content: m.content,
            reasoning: m.reasoning,
            model: m.role === 'assistant' ? m.model : null,
            // 保留 token 统计(克隆的对话沿用原消耗记录)
            promptTokens: m.role === 'assistant' ? m.promptTokens : null,
            completionTokens: m.role === 'assistant' ? m.completionTokens : null,
          })),
        },
      },
    })
    return NextResponse.json(conversation, { status: 201 })
  }

  // 校验 stylePreset(必须为合法 preset id,否则置 null)
  const validPreset = STYLE_PRESETS.find((p) => p.id === body.stylePreset)?.id ?? null
  // 校验 maskId(必须为合法内置面具 id,否则置 null;前端可显式传 null 表示无面具)
  const validMaskId = body.maskId == null ? null : ((await getMaskById(body.maskId, session.user.id))?.ref ?? null)
  // styleOffset 仍接受但仅作为 preset 推导的兜底
  const legacyOffset =
    typeof body.styleOffset === 'number' && Number.isFinite(body.styleOffset)
      ? Math.max(0, Math.min(100, Math.round(body.styleOffset)))
      : 50

  const conversation = await prisma.conversation.create({
    data: {
      userId: session.user.id,
      title: body.title || '新对话',
      model: body.model || 'gpt-4o',
      styleOffset: legacyOffset,
      stylePreset: validPreset, // 新版 preset(优先);null 时应用层回退到 balanced
      maskId: validMaskId, // 面具;null 时不启用
      ...(body.mode === 'compare' ? { mode: 'compare' } : {}),
      ...(body.compareModels ? { compareModels: JSON.stringify(body.compareModels) } : {}),
    },
  })

  return NextResponse.json(conversation, { status: 201 })
}
