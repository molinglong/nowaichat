import { appendFile, mkdir } from "fs/promises"
import path from "path"

/**
 * 轻量监控点 —— 手动回归期间的观测埋点(观测用,非业务日志)。
 *
 * - fire-and-forget 追加写 logs/monitor.log(JSON Lines,每行一事件),同时 console
 *   输出带 [MONITOR] 前缀便于在 dev 终端直接看;
 * - 任何写日志失败静默吞掉,绝不影响主流程;
 * - 只记事件名 + 少量非敏感字段(id/状态码/数量/长度);禁止传 token、密钥、口令;
 * - 仅限 node runtime(route handler 与 lib/server 模块);middleware(edge runtime)
 *   不能导入本模块,那边用 console.log 输出同前缀的行即可。
 */
const LOG_DIR = path.join(process.cwd(), "logs")
const LOG_FILE = path.join(LOG_DIR, "monitor.log")

export function monitor(event: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), event, ...data }) + "\n"
  console.log(`[MONITOR] ${line.trim()}`)
  mkdir(LOG_DIR, { recursive: true })
    .then(() => appendFile(LOG_FILE, line, "utf8"))
    .catch(() => {})
}
