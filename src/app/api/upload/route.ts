import { NextRequest, NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import path from "path"
import { auth } from "@/lib/auth"
import { nanoid } from "nanoid"
import {
  UPLOAD_DIR,
  sanitizeUploadName,
  deleteUploadFile,
  collectReferencedUploadNames,
  sweepOrphanUploads,
} from "@/lib/uploads"
import { prisma } from "@/lib/db"
import { parsePdf, parseTextFile } from "@/lib/file-parser"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
// 支持图片、纯文本与 PDF;文本类扩展名兜底(Windows 下 .md/.json 可能被判为 octet-stream)
const ALLOWED_TYPE_PREFIXES = ["image/", "text/"]
const EXTRA_MIME_TYPES = ["application/pdf", "application/json"]
const TEXT_EXT_FALLBACK = new Set([".txt", ".md", ".markdown", ".csv", ".log", ".json"])

/** 归类上传文件:图片 / 文本 / PDF;不支持返回 null */
function resolveKind(mimeType: string, fileName: string): "image" | "text" | "pdf" | null {
  const ext = path.extname(fileName).toLowerCase()
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType === "application/pdf") return "pdf"
  if (
    mimeType.startsWith("text/") ||
    EXTRA_MIME_TYPES.includes(mimeType) ||
    (mimeType === "application/octet-stream" && TEXT_EXT_FALLBACK.has(ext))
  ) {
    return "text"
  }
  return null
}
// 孤儿文件保留时长:超过 24 小时且未被任何消息引用则清理
const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const contentType = req.headers.get("content-type") ?? ""
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 })
  }

  const formData = await req.formData()
  const file = formData.get("file") as File | null

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  // Validate size
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` },
      { status: 413 }
    )
  }

  // Validate type
  const kind = resolveKind(file.type, file.name)
  if (!kind) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}` },
      { status: 415 }
    )
  }

  // Generate unique filename(扩展名白名单化,保证后续清理/删除接口可识别)
  const rawExt = path.extname(file.name) || ""
  const ext = /^\.[A-Za-z0-9]{1,10}$/.test(rawExt) ? rawExt : ""
  const uniqueName = `${nanoid(12)}${ext}`

  // Ensure uploads directory exists
  const uploadDir = UPLOAD_DIR
  await mkdir(uploadDir, { recursive: true })

  // Write file to disk
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const filePath = path.join(uploadDir, uniqueName)
  await writeFile(filePath, buffer)

  // 中转站:上传时即解析,聊天发送时直接取结果(失败不阻塞上传,标记 failed 供前端提示)
  let parseStatus: "done" | "failed" | "skipped" = "skipped"
  let parseError: string | null = null
  let parseText: string | null = null
  let pageCount: number | null = null
  try {
    if (kind === "text") {
      parseText = parseTextFile(buffer).text
      parseStatus = "done"
    } else if (kind === "pdf") {
      const parsed = await parsePdf(buffer)
      parseText = parsed.text
      pageCount = parsed.pageCount ?? null
      parseStatus = "done"
    }
  } catch (err) {
    parseStatus = "failed"
    parseError = err instanceof Error ? err.message : "解析失败"
    console.error("[upload] Parse failed:", file.name, err)
  }

  // 登记中转站记录;失败则回滚已落盘文件,避免出现无记录的孤儿
  try {
    await prisma.uploadFile.create({
      data: {
        userId: session.user.id,
        fileName: uniqueName,
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
        parseStatus,
        parseError,
        parseText,
        pageCount,
        charCount: parseText?.length ?? null,
      },
    })
  } catch (err) {
    await deleteUploadFile(uniqueName).catch(() => {})
    console.error("[upload] Failed to create UploadFile record:", err)
    return NextResponse.json({ error: "Failed to register upload" }, { status: 500 })
  }

  // 顺手清理孤儿文件(上传了但从未发送、超过 24 小时未被引用的文件)
  sweepOrphanUploads(ORPHAN_MAX_AGE_MS).catch((err) => {
    console.error("[upload] Orphan sweep failed:", err)
  })

  return NextResponse.json({
    url: `/uploads/${uniqueName}`,
    name: file.name,
    type: file.type,
    size: file.size,
    parseStatus,
    ...(parseError ? { parseError } : {}),
    ...(pageCount != null ? { pageCount } : {}),
    ...(parseText != null ? { charCount: parseText.length } : {}),
  })
}

/**
 * 删除上传文件。仅允许删除"未被任何消息引用"的文件,
 * 已发送的附件文件需通过删除会话/消息级联清理。
 * Query: ?file=<filename>
 */
export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const fileParam = searchParams.get("file")
  if (!fileParam) {
    return NextResponse.json({ error: "file query parameter is required" }, { status: 400 })
  }

  const name = sanitizeUploadName(fileParam)
  if (!name) {
    return NextResponse.json({ error: "Invalid file name" }, { status: 400 })
  }

  // 已被消息引用的文件不允许单独删除(避免破坏历史消息展示)
  const referenced = await collectReferencedUploadNames()
  if (referenced.has(name)) {
    return NextResponse.json(
      { error: "File is referenced by a message and cannot be deleted" },
      { status: 409 }
    )
  }

  await deleteUploadFile(name)
  return NextResponse.json({ success: true })
}
