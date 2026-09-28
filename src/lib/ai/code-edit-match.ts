/**
 * code_edit 片段编辑的匹配引擎 —— 参照 ZCode Edit 工具的核心语义做最小子集：
 *
 * 1. 精确匹配优先；0 处 → not_found，多处且未开 replace_all → ambiguous。
 * 2. 二级回退「逐行 trim 匹配」(ZCode 的 line_trimmed 策略)：模型复制的片段
 *    常有缩进漂移,行内 trim 后唯一命中即可定位；替换内容仍用模型给的 new_text 原文。
 *    仅单片段替换可用该回退（replaceAll 只作用于精确匹配,与 ZCode 一致）。
 * 3. 替换一律用函数替换器 —— 避免 String.replace 把 new_text 里的 $&/$1 当特殊语义。
 * 4. 匹配前 CRLF→LF 归一（Monaco 与模型输出都以 \n 为主,入库内容可能带 \r）；
 *    归一后命中的,返回的 modifiedContent 也是归一后的全文（Monaco 渲染无差异）。
 *
 * 纯函数、isomorphic,前端 ChatPanel 使用,不依赖任何运行时。
 */

export interface CodeEditMatchResult {
  status: "ok" | "not_found" | "ambiguous" | "empty_old" | "no_change" | "empty_content"
  /** ambiguous 时的命中处数 */
  count?: number
  /** status=ok 时:应用替换后的完整文档内容 */
  modifiedContent?: string
  /** status=ok 时:实际使用的匹配策略（回填给模型,提示下次优先精确复制） */
  strategy?: "exact" | "line-trimmed"
  /** 非 ok 时给模型的可行动错误文案（怎么改下一次才能成功） */
  message?: string
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

/** 逐行 trim 匹配:在行级滑窗中找「逐行 trim 后与目标逐行相等」的唯一窗口 */
function findLineTrimmedWindow(
  lines: readonly string[],
  needleLines: readonly string[]
): number | null {
  if (needleLines.length === 0 || needleLines.length > lines.length) return null
  const hits: number[] = []
  outer: for (let i = 0; i + needleLines.length <= lines.length; i++) {
    for (let j = 0; j < needleLines.length; j++) {
      if (lines[i + j].trim() !== needleLines[j]) continue outer
    }
    hits.push(i)
  }
  return hits.length === 1 ? hits[0] : null
}

/**
 * 在 content 中把 old_text 替换为 new_text。
 * @param content    文档当前完整内容
 * @param oldText    模型给的要替换片段（需在文档中唯一,除非 replaceAll）
 * @param newText    替换后的片段（与 oldText 相同会被拒绝）
 * @param replaceAll true=替换全部精确命中（片段级模糊回退禁用）
 */
export function applyCodeEdit(
  content: string,
  oldText: string,
  newText: string,
  replaceAll = false
): CodeEditMatchResult {
  const normalizedContent = content.replace(/\r\n/g, "\n")
  const from = oldText.replace(/\r\n/g, "\n")
  const to = newText.replace(/\r\n/g, "\n")

  if (!from.trim()) {
    // 空 old_text 仅当文档本身为空时合法（整篇写入）
    if (normalizedContent.trim() === "") {
      return { status: "ok", modifiedContent: to, strategy: "exact" }
    }
    return {
      status: "empty_content",
      message:
        "old_text 为空,但文档不是空的——片段替换必须提供要替换的原文。" +
        "请先读取文档当前内容,取要修改的片段（带前后几行）作为 old_text。",
    }
  }
  if (from === to) {
    return {
      status: "no_change",
      message: "old_text 与 new_text 完全相同,没有需要替换的内容。请返回真正修改后的片段。",
    }
  }

  // 一级:精确匹配
  const exactCount = countOccurrences(normalizedContent, from)
  if (exactCount > 0) {
    if (exactCount > 1 && !replaceAll) {
      return {
        status: "ambiguous",
        count: exactCount,
        message:
          `old_text 在文档中命中 ${exactCount} 处。请在片段前后各带几行上下文以唯一定位;` +
          `若确需替换全部 ${exactCount} 处,传 replace_all: true。`,
      }
    }
    const modifiedContent = replaceAll
      ? normalizedContent.split(from).join(to) // split/join 等价全量替换,无 $ 语义陷阱
      : normalizedContent.replace(from, () => to)
    return { status: "ok", modifiedContent, strategy: "exact" }
  }

  // 二级:逐行 trim 匹配（replaceAll 不走模糊回退,与 ZCode 一致）
  if (!replaceAll) {
    const lines = normalizedContent.split("\n")
    const needleLines = from.replace(/\n$/, "").split("\n").map((l) => l.trim())
    const win = findLineTrimmedWindow(lines, needleLines)
    if (win !== null) {
      const replacementLines = to.replace(/\n$/, "").split("\n")
      const next = [...lines.slice(0, win), ...replacementLines, ...lines.slice(win + needleLines.length)]
      return { status: "ok", modifiedContent: next.join("\n"), strategy: "line-trimmed" }
    }
  }

  return {
    status: "not_found",
    message:
      "old_text 在文档中未找到（精确与忽略缩进两级匹配都未命中）。" +
      "old_text 必须与文档当前内容逐字一致（含缩进/标点）——请基于最近一次读到的原文取片段,不要凭记忆改写;" +
      "片段取要修改的代码块及其前后 1~3 行即可,不必整篇。",
  }
}
