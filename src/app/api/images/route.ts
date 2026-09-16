import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  generateImage,
  editImage,
  generateImageWithReference,
  supportsReferenceImage,
  type EditType,
} from "@/lib/ai/image"

export const maxDuration = 90 // seconds

/**
 * GET /api/images
 * Query: ?limit=&offset=
 * 返回当前用户的生图历史(按时间倒序)
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(req.url)
  const limit = Math.max(1, Math.min(100, Number(searchParams.get("limit") ?? 24)))
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0))

  const [items, total] = await Promise.all([
    prisma.generatedImage.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.generatedImage.count({ where: { userId } }),
  ])

  return NextResponse.json({ items, total, limit, offset })
}

/**
 * POST /api/images
 *
 * 文生图模式 (t2i):
 *   { prompt, source? }
 *
 * 文生图 + 参考图模式 (reference):
 *   { prompt, referenceImageUrl, source? }
 *   强制走图像编辑模型(qwen-image-edit)
 *
 * 二创模式 (edit / inpaint / variation):
 *   { prompt, source?, parentId, editType, maskRect?, n? }
 *   - editType: "edit" | "inpaint" | "variation"
 *   - maskRect: { x, y, w, h } 0~1 归一化坐标 (仅 inpaint 需要)
 *   - n: 生成数量 (仅 variation,默认 1)
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  let body: {
    prompt?: string
    source?: string
    parentId?: string
    editType?: EditType
    maskRect?: { x: number; y: number; w: number; h: number }
    n?: number
    modelId?: string
    referenceImageUrl?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const prompt = (body.prompt ?? "").trim()
  const source = body.source === "chat" ? "chat" : "workspace"
  const n = Math.max(1, Math.min(4, Number(body.n ?? 1)))
  const editType: EditType | null = body.editType ?? null

  // 二创路径
  if (editType) {
    if (!body.parentId) {
      return NextResponse.json({ error: "二创必须提供 parentId" }, { status: 400 })
    }
    if (editType !== "variation" && !prompt) {
      return NextResponse.json({ error: "edit/inpaint 必须提供提示词" }, { status: 400 })
    }
    if (prompt.length > 500) {
      return NextResponse.json({ error: "prompt 不能超过 500 字" }, { status: 400 })
    }

    const parent = await prisma.generatedImage.findFirst({
      where: { id: body.parentId, userId },
    })
    if (!parent) {
      return NextResponse.json({ error: "父图不存在或无权访问" }, { status: 404 })
    }

    try {
      const results = await editImage({
        userId,
        sourceUrl: parent.url,
        sourceWidth: parent.width,
        sourceHeight: parent.height,
        prompt,
        editType,
        maskRect: body.maskRect,
        n,
        modelId: body.modelId,
      })

      const records = await Promise.all(
        results.map((r) =>
          prisma.generatedImage.create({
            data: {
              userId,
              prompt: prompt || `(variation of ${parent.id.slice(0, 6)})`,
              url: r.url,
              model: r.model,
              width: r.width,
              height: r.height,
              size: parent.size,
              source,
              parentId: parent.id,
              editType,
              maskRect: body.maskRect ? JSON.stringify(body.maskRect) : null,
            },
          })
        )
      )
      // variation 多张时只返回第一张作为主预览,全部通过 items 字段返回
      return NextResponse.json({
        primary: records[0],
        items: records,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "二创生成失败"
      console.error("[images] Edit failed:", message)
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  // 文生图路径
  if (!prompt) {
    return NextResponse.json({ error: "prompt 不能为空" }, { status: 400 })
  }
  if (prompt.length > 500) {
    return NextResponse.json({ error: "prompt 不能超过 500 字" }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { imageModel: true, imageSize: true },
  })
  const modelId = user?.imageModel ?? "builtin:wanx2.1-t2i-turbo"
  const size = user?.imageSize ?? "1024*1024"

  // 文生图 + 参考图:校验 + 路由到 generateImageWithReference
  if (body.referenceImageUrl) {
    const refUrl = body.referenceImageUrl.trim()
    if (!refUrl.startsWith("/uploads/")) {
      return NextResponse.json(
        { error: "referenceImageUrl 必须为 /uploads/ 开头的本地相对路径" },
        { status: 400 }
      )
    }
    if (!supportsReferenceImage(modelId)) {
      return NextResponse.json(
        {
          error:
            "当前选中的模型不支持参考图,请先在顶部下拉切换到「通义千问 · 图像编辑」",
        },
        { status: 400 }
      )
    }

    try {
      const result = await generateImageWithReference({
        userId,
        modelId,
        referenceImageUrl: refUrl,
        prompt,
        size,
      })
      const record = await prisma.generatedImage.create({
        data: {
          userId,
          prompt,
          url: result.url,
          model: result.model,
          width: result.width,
          height: result.height,
          size,
          source,
          // editType 沿用 'edit',历史记录/筛选与二创「以图生图」共用通道
          editType: "edit",
          referenceImageUrl: refUrl,
        },
      })
      return NextResponse.json(record)
    } catch (err) {
      const message = err instanceof Error ? err.message : "参考图生图失败"
      console.error("[images] Reference generation failed:", message)
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  try {
    const result = await generateImage(userId, modelId, prompt, size)
    const record = await prisma.generatedImage.create({
      data: {
        userId,
        prompt,
        url: result.url,
        model: result.model,
        width: result.width,
        height: result.height,
        size,
        source,
      },
    })
    return NextResponse.json(record)
  } catch (err) {
    const message = err instanceof Error ? err.message : "图片生成失败"
    console.error("[images] Generate failed:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
