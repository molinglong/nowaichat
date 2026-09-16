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

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
// 本期仅支持图片与纯文本(用户已确认 PDF 暂不支持)
const ALLOWED_TYPE_PREFIXES = ["image/", "text/"]
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
  const allowed = ALLOWED_TYPE_PREFIXES.some((prefix) => file.type.startsWith(prefix))
  if (!allowed) {
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

  // 顺手清理孤儿文件(上传了但从未发送、超过 24 小时未被引用的文件)
  sweepOrphanUploads(ORPHAN_MAX_AGE_MS).catch((err) => {
    console.error("[upload] Orphan sweep failed:", err)
  })

  return NextResponse.json({
    url: `/uploads/${uniqueName}`,
    name: file.name,
    type: file.type,
    size: file.size,
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
