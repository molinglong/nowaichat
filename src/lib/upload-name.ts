/**
 * 上传文件名规范与校验(纯函数,无 fs/prisma 依赖)。
 * 独立成模块的原因:/uploads 静态兜底路由是公开路由,
 * 不能因复用校验函数而把 prisma/pg 链路打进它的 standalone trace。
 */
import path from "path"

/** 上传时生成的唯一文件名:nanoId(12) + 扩展名 */
const UPLOAD_NAME_REGEX = /^[\w-]{8,32}(\.[A-Za-z0-9]{1,10})?$/

/**
 * 从 URL(/uploads/xxx.png)或文件名中提取并校验文件名,
 * 防止路径穿越;非法时返回 null。
 */
export function sanitizeUploadName(input: string): string | null {
  let name = input.trim()
  if (name.includes("/")) {
    name = path.basename(name)
  }
  if (!UPLOAD_NAME_REGEX.test(name)) return null
  return name
}
