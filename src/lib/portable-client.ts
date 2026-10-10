/**
 * 浏览器侧的会话包下载器 —— 单条右键导出、批量勾选导出、设置页「导出全部」共用。
 *
 * 为什么不各写一份:三个入口的差别只有 ids 长度,而"取 JSON → 拼 Blob → 触发下载 →
 * 回收 objectURL"这一串里最容易出错的是 objectURL 泄漏和文件名清洗,
 * 留在一处只错一次。
 */

export interface DownloadBundleOptions {
  /** 指定会话 id 列表(与 all 二选一) */
  ids?: string[]
  /** 导出当前模式下全部会话 */
  all?: boolean
  /** 设置→用户中心 的临时对话隔离区导出口径 */
  scope?: 'ephemeral'
  /** 落地文件名(不含扩展名也接受,内部会补 .aichat.json) */
  fileName?: string
}

/** 下载动作的回报:让用户知道"少了几条"到底是真少了还是本模式看不见 */
export interface DownloadBundleResult {
  exported: number
  skipped: number
  truncated?: boolean
}

/** 标题→安全文件名:Windows 保留字符与换行一律换成空格,长度封顶 50 */
function safeFileName(raw: string): string {
  const cleaned = raw.replace(/[\\/:*?"<>|\n\r]/g, ' ').trim().slice(0, 50)
  return cleaned || '对话包'
}

export async function downloadConversationBundle(
  opts: DownloadBundleOptions
): Promise<DownloadBundleResult> {
  const res = await fetch('/api/conversations/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(opts.ids ? { ids: opts.ids } : {}),
      ...(opts.all ? { all: true } : {}),
      ...(opts.scope ? { scope: opts.scope } : {}),
    }),
  })
  const data = (await res.json().catch(() => null)) as
    | { bundle?: unknown; exported?: number; skipped?: number; truncated?: boolean; error?: string }
    | null

  if (!res.ok || !data?.bundle) {
    throw new Error(typeof data?.error === 'string' ? data.error : `导出失败（HTTP ${res.status}）`)
  }

  const json = JSON.stringify(data.bundle, null, 2)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeFileName(opts.fileName ?? `aichat-对话包-${new Date().toISOString().slice(0, 10)}`)}.aichat.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)

  return {
    exported: data.exported ?? 0,
    skipped: data.skipped ?? 0,
    truncated: data.truncated,
  }
}
