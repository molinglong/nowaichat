import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import { deleteReferencedFiles } from '@/lib/uploads'
import { getMaskById } from '@/lib/ai/mask-resolve'

/**
 * GET /api/conversations/[id]
 *
 * 返回单个会话的完整数据,包括消息列表。
 * 设计目的:让 /chat/c/[id] 可以是 Client Component,
 * 这样 Tauri 桌面端静态导出时,该页不再依赖 Server runtime。
 *
 * 返回结构:
 * {
 *   id, title, model, mode, styleOffset,
 *   compareModels: string[],   // 已 JSON.parse 过的数组(对比模式)
 *   messages: Array<{
 *     id, role, content, reasoning?, model?, groupId?,
 *     attachments: Attachment[],   // 已 JSON.parse
 *     promptTokens?, completionTokens?, createdAt
 *   }>
 * }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = params

  // A 流式恢复: 超时兜底——超过 10 分钟仍处于 streaming 的草稿行视为已中断,
  // 定格为普通消息,避免前端无限轮询(快照周期 600ms,正常生成远短于该阈值)。
  // 对比模式无草稿行,此 updateMany 无副作用。
  await prisma.message.updateMany({
    where: {
      conversationId: id,
      streaming: true,
      createdAt: { lt: new Date(Date.now() - 10 * 60 * 1000) },
    },
    data: { streaming: false },
  })

  const conversation = await prisma.conversation.findFirst({
    where: {
      id,
      userId: session.user.id,
    },
    include: {
      messages: {
        // C 分支轻量版: 归档消息不在正常列表中展示(仅回看端点可见)
        where: { archived: false },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!conversation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // 解析 JSON 字段供前端直接消费,避免前端重复处理
  const messages = conversation.messages.map((m) => {
    let attachments: unknown[] = []
    if (m.attachments) {
      try {
        const parsed = JSON.parse(m.attachments)
        if (Array.isArray(parsed)) attachments = parsed
      } catch {
        // 损坏 JSON 返回空数组,前端兜底处理
      }
    }
    let metadata: unknown = null
    if (m.metadata) {
      try {
        const parsed = JSON.parse(m.metadata)
        if (parsed && typeof parsed === 'object') metadata = parsed
      } catch {
        // 损坏 JSON 视为无 metadata,前端按普通 system 文本渲染
      }
    }
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      reasoning: m.reasoning,
      model: m.model,
      groupId: m.groupId,
      streaming: m.streaming,
      attachments,
      // 结构化 UI 提示:{kind, sourceId, sourceTitle, ...}
      // 仅由后端写入;前端按 kind 分发渲染分支
      metadata,
      promptTokens: m.promptTokens,
      completionTokens: m.completionTokens,
      createdAt: m.createdAt,
    }
  })

  let compareModels: string[] = []
  if (conversation.compareModels) {
    try {
      const parsed = JSON.parse(conversation.compareModels)
      if (Array.isArray(parsed)) compareModels = parsed.filter((x): x is string => typeof x === 'string')
    } catch {
      // ignore
    }
  }

  // E 对比模式投票: 返回最新一轮投票(对比模式回显高亮用)
  const latestVote = await prisma.compareVote.findFirst({
    where: { conversationId: id, userId: session.user.id },
    orderBy: { updatedAt: 'desc' },
    select: { groupId: true, votedModel: true },
  })

  return NextResponse.json({
    id: conversation.id,
    title: conversation.title,
    model: conversation.model,
    mode: conversation.mode ?? 'single',
    styleOffset: conversation.styleOffset ?? 0,
    stylePreset: conversation.stylePreset ?? null, // 新版 preset(null = balanced)
    maskId: conversation.maskId ?? null, // 面具(null = 无面具)
    compareModels,
    latestVote: latestVote ?? null,
    messages,
  })
}

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  model: z.string().min(1).optional(),
  compareModels: z.array(z.string().min(1)).optional(),
  // 转换为单聊时 mode='single'
  mode: z.enum(['single', 'compare']).optional(),
  // 面具:null 清除;字符串必须是合法内置面具 id(将来兼容 user:<cuid>)
  maskId: z.string().min(1).nullable().optional(),
})

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = params

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id },
  })

  if (!conversation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  // maskId 显式传入时校验合法性(未知 id 返回 400);null 表示清除面具
  let maskIdUpdate: string | null | undefined = undefined
  if (parsed.data.maskId !== undefined) {
    if (parsed.data.maskId === null) {
      maskIdUpdate = null
    } else if (await getMaskById(parsed.data.maskId, session.user.id)) {
      maskIdUpdate = parsed.data.maskId
    } else {
      return NextResponse.json({ error: 'Unknown maskId' }, { status: 400 })
    }
  }

  const updated = await prisma.conversation.update({
    where: { id },
    data: {
      title: parsed.data.title,
      model: parsed.data.model,
      mode: parsed.data.mode,
      ...(maskIdUpdate !== undefined ? { maskId: maskIdUpdate } : {}),
      ...(parsed.data.compareModels
        ? { compareModels: JSON.stringify(parsed.data.compareModels) }
        : {}),
      // 转为单聊时清除对比模型列表
      ...(parsed.data.mode === 'single' ? { compareModels: null } : {}),
    },
    select: { id: true, title: true, model: true, mode: true, maskId: true, updatedAt: true },
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = params

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id },
  })

  if (!conversation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // 删除前收集会话内消息引用的附件文件(消息会随会话级联删除)
  const messages = await prisma.message.findMany({
    where: { conversationId: id, attachments: { not: null } },
    select: { attachments: true },
  })

  await prisma.conversation.delete({ where: { id } })

  // 库删除完成后清理磁盘文件
  for (const m of messages) {
    await deleteReferencedFiles(m.attachments)
  }

  return NextResponse.json({ success: true })
}
