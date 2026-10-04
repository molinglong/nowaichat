/**
 * 复制工具 —— 轮盘扇区点击/mouseup 结算等场景可能拿不到 transient activation
 * 或处于剪贴板权限受限的嵌入式 webview,导致 navigator.clipboard.writeText 被拒。
 * 此时退回隐藏 textarea + document.execCommand('copy')(同步,不受 permissions-policy 限制)。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 落入兜底
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:-9999px;left:0;opacity:0;'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
