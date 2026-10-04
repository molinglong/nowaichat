import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import {
  generateImage,
  editImage,
  generateImageWithReference,
  supportsReferenceImage,
  type EditType,
  type OnGenProgress,
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
    return NextResponse.json({ error: "登录已失效，请重新登录后再试" }, { status: 401 })
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

/** 客户端声明接受 NDJSON 时才走流式进度(fetch 无法用 EventSource,故选 NDJSON over POST) */
function wantsStream(req: NextRequest): boolean {
  return (req.headers.get("accept") ?? "").includes("application/x-ndjson")
}

/**
 * 统一执行 + 响应:
 *  - 非流式(Accept 不含 application/x-ndjson):保持原 JSON 行为(旧客户端/其它调用方兼容)
 *  - 流式:逐行 NDJSON 事件 {type:"stage"|"done"|"error", ...},让前端展示真实阶段进度
 */
async function respond(
  req: NextRequest,
  execute: (onProgress?: OnGenProgress) => Promise<unknown>,
  label: string
): Promise<Response> {
  if (!wantsStream(req)) {
    try {
      return NextResponse.json(await execute())
    } catch (err) {
      const message = err instanceof Error ? err.message : "图片生成失败"
      console.error(`[images] ${label} failed:`, message)
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  const encoder = new TextEncoder()
  const startedAt = Date.now()
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (evt: Record<string, unknown>) => {
        if (closed) return
        try {
          controller.enqueue(
            encoder.encode(JSON.stringify({ ...evt, elapsedMs: Date.now() - startedAt }) + "\n")
          )
        } catch {
          // 客户端已断开(导航/取消),后续事件直接丢弃
          closed = true
        }
      }
      try {
        const payload = await execute((stage, info) =>
          emit({ type: "stage", stage, ...(info?.poll ? { poll: info.poll } : {}) })
        )
        emit({ type: "done", payload })
      } catch (err) {
        const message = err instanceof Error ? err.message : "图片生成失败"
        console.error(`[images] ${label} failed:`, message)
        emit({ type: "error", message })
      } finally {
        closed = true
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // 反代(宝塔 nginx)不缓冲响应,保证阶段事件实时到达
      "X-Accel-Buffering": "no",
    },
  })
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
 *
 * 进度:请求头 Accept: application/x-ndjson 时返回阶段事件流(见 respond)
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "登录已失效，请重新登录后再试" }, { status: 401 })
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
    return NextResponse.json({ error: "请求体不是合法的 JSON" }, { status: 400 })
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

    return respond(
      req,
      async (onProgress) => {
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
          onProgress,
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
        return { primary: records[0], items: records }
      },
      "Edit"
    )
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

    return respond(
      req,
      async (onProgress) => {
        const result = await generateImageWithReference({
          userId,
          modelId,
          referenceImageUrl: refUrl,
          prompt,
          size,
          onProgress,
        })
        return prisma.generatedImage.create({
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
      },
      "Reference generation"
    )
  }

  return respond(
    req,
    async (onProgress) => {
      const result = await generateImage(userId, modelId, prompt, size, onProgress)
      return prisma.generatedImage.create({
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
    },
    "Generate"
  )
}
