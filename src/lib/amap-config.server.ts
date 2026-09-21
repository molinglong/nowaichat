import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/crypto"

/**
 * 解析当前用户生效的高德配置:设置页配置(AmapKey 表)优先,环境变量兜底。
 * 字段级独立回落 —— 用户只覆盖某一项(如仅修 wsKey 的 IP 白名单问题)时,
 * 其余项沿用服务器默认;清除某项(置空)= 回落该项的 env 值。
 */
export async function resolveAmapConfig(userId: string): Promise<{
  jsKey: string
  sec: string
  wsKey: string
}> {
  let jsKey = process.env.AMAP_JS_KEY || ""
  let sec = process.env.AMAP_JS_SEC || ""
  let wsKey = process.env.AMAP_WS_KEY || ""
  try {
    const rec = await prisma.amapKey.findUnique({ where: { userId } })
    if (rec) {
      if (rec.jsKey) jsKey = rec.jsKey
      if (rec.encryptedSec) {
        try {
          sec = decrypt(rec.encryptedSec)
        } catch {
          // 解密失败(如 ENCRYPTION_KEY 变更)保留 env 兜底
        }
      }
      if (rec.encryptedWs) {
        try {
          wsKey = decrypt(rec.encryptedWs)
        } catch {
          // 同上
        }
      }
    }
  } catch {
    // 表查询失败不阻塞:保留 env 兜底
  }
  return { jsKey, sec, wsKey }
}
