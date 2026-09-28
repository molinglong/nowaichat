import type * as Ts from "typescript"

/**
 * write_code 语法校验（服务端专用，勿从客户端组件 import —— 依赖 typescript 包）。
 *
 * 设计原则：宁漏勿误报。只报「确定是错」的硬错误（write_code 会拒绝落库并打回模型重试）
 * 和少量高置信警告（不阻塞落库，附在成功 output 里）。没有本地解析器的语言
 * （Python/Rust/Go 等 22 种里的绝大多数）只做 Markdown 围栏残留检查，绝不猜。
 *
 * TS/JS 用 typescript 包做 parse 级语法诊断（transpileModule + reportDiagnostics，
 * 只报语法错，不做类型检查——类型错误交给运行者）。按 .tsx/.jsx 解析：
 * 模型把 React 组件标成 "typescript"（实为 tsx）是高频行为，.ts 解析 JSX 必炸、
 * .ts 不带 JSX 又会把 `<div>hi</div>` 误判成旧式类型断言——tsx 是 ts 超集，
 * 唯一代价是极少数 `<T>expr` 旧断言语法会误报，可接受。
 * yaml/css 等文本类只做括号/结构失衡的**警告**级检查，不硬拒。
 */

export interface SyntaxIssue {
  /** 1-based 行号（拿不到时为 0） */
  line: number
  /** 1-based 列号（拿不到时为 0） */
  column: number
  message: string
}

export interface SyntaxCheckResult {
  /** 硬错误：write_code 拒绝保存，模型须修正后重试 */
  errors: SyntaxIssue[]
  /** 软警告：照常保存，附在工具结果里供模型/用户参考 */
  warnings: SyntaxIssue[]
}

/** 诊断条数上限：全量发给模型既贵又稀释重点 */
const MAX_ISSUES = 5

let tsModulePromise: Promise<typeof Ts | null> | null = null

/** 惰性加载 typescript（CJS 互兼容 default/namespace 两种形状）；加载失败静默降级为只做围栏检查 */
async function loadTs(): Promise<typeof Ts | null> {
  if (!tsModulePromise) {
    tsModulePromise = import("typescript")
      .then((m) => ((m as { default?: typeof Ts }).default ?? (m as unknown as typeof Ts)))
      .catch(() => null)
  }
  return tsModulePromise
}

/** Markdown 围栏残留：模型最常见的污染形态（```lang 开头）。命中即硬错误 */
function findFence(code: string): SyntaxIssue | null {
  if (/^\s*```/.test(code)) {
    return { line: 1, column: 1, message: "代码以 Markdown 围栏（```）开头——请只提交纯代码正文，不要包含围栏或解释文字" }
  }
  return null
}

/** 单个 HTML 标签的开/闭计数 */
function countHtmlTag(code: string, tag: string): { open: number; close: number } {
  const open = (code.match(new RegExp(`<${tag}(?=[\\s>/])`, "gi")) ?? []).length
  const close = (code.match(new RegExp(`</${tag}\\s*>`, "gi")) ?? []).length
  return { open, close }
}

/** HTML 高置信检查：script/style 未闭合=硬错误（这两个标签自闭合不合法，漏闭必炸）；html/body 失衡=警告 */
function checkHtml(code: string): SyntaxCheckResult {
  const errors: SyntaxIssue[] = []
  const warnings: SyntaxIssue[] = []
  for (const tag of ["script", "style"]) {
    const { open, close } = countHtmlTag(code, tag)
    if (open > close) {
      errors.push({ line: 0, column: 0, message: `存在 ${open - close} 个未闭合的 <${tag}> 标签` })
    }
  }
  for (const tag of ["html", "body"]) {
    const { open, close } = countHtmlTag(code, tag)
    if (open > 0 && close < open) {
      warnings.push({ line: 0, column: 0, message: `<${tag}> 标签疑似未闭合（开 ${open} 处 / 闭 ${close} 处）` })
    }
  }
  return { errors, warnings }
}

/** CSS 花括号失衡只做警告（content:"}" 等字符串会干扰计数） */
function checkCss(code: string): SyntaxCheckResult {
  const open = (code.match(/{/g) ?? []).length
  const close = (code.match(/}/g) ?? []).length
  if (open !== close) {
    return { errors: [], warnings: [{ line: 0, column: 0, message: `花括号数量不平衡（{ ${open} 处 / } ${close} 处），请检查是否漏写或多余` }] }
  }
  return { errors: [], warnings: [] }
}

/** TS/JS parse 级语法诊断 */
async function checkTsJs(code: string, language: "typescript" | "javascript"): Promise<SyntaxCheckResult> {
  const ts = await loadTs()
  if (!ts) return { errors: [], warnings: [] }
  const out = ts.transpileModule(code, {
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ES2020,
    },
    reportDiagnostics: true,
    fileName: language === "typescript" ? "doc.tsx" : "doc.jsx",
  })
  const errors: SyntaxIssue[] = []
  for (const d of out.diagnostics ?? []) {
    if (d.category !== ts.DiagnosticCategory.Error) continue
    let line = 0
    let column = 0
    if (d.file && typeof d.start === "number") {
      const pos = ts.getLineAndCharacterOfPosition(d.file, d.start)
      line = pos.line + 1
      column = pos.character + 1
    }
    errors.push({ line, column, message: ts.flattenDiagnosticMessageText(d.messageText, "\n") })
    if (errors.length >= MAX_ISSUES) break
  }
  return { errors, warnings: [] }
}

/**
 * 语言分发入口。language 已经过 normalizeCodeLanguage 归一（未知值会落 typescript），
 * 调用方（write-code-tool.server）保证传入的是 CODE_LANGUAGE_IDS 内的值。
 */
export async function checkCodeSyntax(language: string, code: string): Promise<SyntaxCheckResult> {
  const fence = findFence(code)
  if (fence) return { errors: [fence], warnings: [] }

  switch (language) {
    case "typescript":
    case "javascript":
      return checkTsJs(code, language)
    case "html":
      return checkHtml(code)
    case "css":
      return checkCss(code)
    case "json":
      try {
        JSON.parse(code)
        return { errors: [], warnings: [] }
      } catch (e) {
        return { errors: [{ line: 0, column: 0, message: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}` }], warnings: [] }
      }
    default:
      // Python/Rust/Go/Java/YAML/SQL 等无本地解析器：不猜，只过了围栏检查
      return { errors: [], warnings: [] }
  }
}

/** 渲染成给模型看的单行文案：「行x列y: message」/「message」 */
export function formatSyntaxIssue(issue: SyntaxIssue): string {
  if (issue.line > 0) return `行${issue.line}列${issue.column}: ${issue.message}`
  return issue.message
}
