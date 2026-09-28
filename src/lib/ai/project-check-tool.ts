import { tool } from "ai"
import { z } from "zod"
import { EXEC_CONFIRM_PATTERNS } from "./local-file-tool"

/**
 * 项目检查工具（project_check）—— AI 改完本地工作区文件后的验收闭环。
 *
 * 解决的问题：agent 用 local_file create/edit 改了用户的工程文件后是"盲改"——
 * 类型错误、编译失败、测试红了只有用户跑起来才发现，AI 自己不知道还能宣称"已完成"。
 * 本工具让 AI 改完主动调用：前端经 Tauri lf_exec 在工作区根真实运行检查命令
 * （tsc/eslint/测试），stdout/stderr 原样回填 —— 模型看到报错 → 修 → 复跑，
 * 直到 exitCode=0 才算完成。与 preview_check（HTML 预览验证）互补，覆盖本地工程文件。
 *
 * 与 local_file / code_edit / preview_check 同属"无 execute 客户端工具"：服务端只发
 * tool-call 即停步（stopWhen 已加本工具名），前端 ChatPanel.onToolCall 拦截执行，
 * addToolOutput 回填，sendAutomaticallyWhen 触发同轮续跑。依赖 Tauri lf_exec，
 * 仅桌面端可用（注入闸门与 local_file 同源）；配套收工验收门见 verify-gate.ts。
 */

export const PROJECT_CHECK_TOOL_NAME = "project_check"

export const projectCheckInputSchema = z.object({
  command: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "要运行的检查命令(工作目录=工作区根)。只允许纯检查类命令(白名单见工具描述)," +
        "通过后自动执行;白名单外会拒绝并提示改用 local_file exec。"
    ),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .max(180_000)
    .optional()
    .describe(
      "可选:超时毫秒数(上限 180000,缺省 120000)。大项目 tsc 全量较慢,按体量预估传入;" +
        "超时会被强制终止(exitCode=-1)。"
    ),
})

export type ProjectCheckToolInput = z.infer<typeof projectCheckInputSchema>

/** 前端回填给模型的结果形状(随消息 metadata.toolCalls 持久化) */
export interface ProjectCheckToolOutput {
  /** exitCode=0 且成功执行才为 true;其余情况(失败/拒绝/不可用)一律 false */
  ok: boolean
  /** 进程退出码(0=通过;-1 表示超时被强杀) */
  exitCode?: number
  /** 合并输出(stdout+stderr,UTF-8,Rust 侧超 32KB 头尾保留截断) */
  output?: string
  /** 输出被截断 */
  truncated?: boolean
  /** 耗时毫秒 */
  durationMs?: number
  /** 失败/被拒原因(回传给模型,让它如实处理,不臆造通过) */
  error?: string
}

/** 未知形状收窄:卡片/历史回放时判断 output 是否为项目检查结果 */
export function isProjectCheckOutput(o: unknown): o is ProjectCheckToolOutput {
  return !!o && typeof o === "object" && "ok" in (o as Record<string, unknown>)
}

/**
 * 检查命令白名单:纯检查器,不装包、不联网、不写盘(测试运行器会执行工作区内的测试代码,
 * 这是"跑测试"的本意)。npm/npx install 类一律不在——装包会执行任意 postinstall 脚本。
 */
const CHECK_FIRST_WORDS = new Set(["tsc", "eslint", "vitest", "jest", "pytest", "rstest"])

/** npx 仅允许 --no-install 形式直跟检查器:只解析本地 node_modules/.bin,绝不联网下载 */
const CHECK_NPX_TOOLS = new Set(["tsc", "eslint", "vitest", "jest", "rstest"])

/** 白名单摘要(注入提示词与拒绝回填共用,改白名单同步改这里) */
export const CHECK_ALLOWLIST_HINT =
  "tsc / eslint / vitest / jest / pytest / rstest / cargo check / go vet / node --test / " +
  "npx --no-install <检查器>"

/**
 * 判定检查命令是否可自动执行(无需用户确认):
 * ①首词在纯检查器白名单(cargo 限 check、go 限 vet、node 限 --test、npx 限 --no-install+检查器);
 * ②全文不命中 exec 确认档黑名单(挡管道/重定向/路径逃逸/写动词族,与 local_file exec 同源)。
 * 黑名单扫描前剥离 go 风格递归包模式「/...」——它是包列表通配不是路径,真正的 .. 逃逸仍会被拦
 * (如 `go vet ./...` 放行,`rm ../..` 依旧拒绝)。
 */
export function isCheckCommandAllowed(command: string): boolean {
  const raw = command.trim()
  if (!raw || raw.length > 500) return false
  const words = raw.split(/\s+/)
  const first = (words[0] ?? "").toLowerCase()
  const second = (words[1] ?? "").toLowerCase()
  if (first === "npx") {
    if (second !== "--no-install") return false
    if (!CHECK_NPX_TOOLS.has((words[2] ?? "").toLowerCase())) return false
  } else if (first === "cargo") {
    if (second !== "check") return false
  } else if (first === "go") {
    if (second !== "vet") return false
  } else if (first === "node") {
    if (second !== "--test") return false
  } else if (!CHECK_FIRST_WORDS.has(first)) {
    return false
  }
  // go 的递归包模式「pkg/...」是包通配不是路径,剥掉后再过黑名单(.. 逃逸不受影响);
  // 「run」是 vitest/rstest 等的合法子命令但也在 exec 高危词表里,已过首词校验后同样剥掉,
  // 其余黑名单词保持原样从严(管道/重定向/写动词等仍一律拒绝)
  const scanned = raw.replace(/\/\.\.\./g, "/").replace(/\brun\b/gi, "sub")
  for (const re of EXEC_CONFIRM_PATTERNS) {
    if (re.test(scanned)) return false
  }
  return true
}

/** 创建项目检查工具(无 execute,执行在前端经 Tauri lf_exec:见文件头注释) */
export function createProjectCheckTool() {
  return tool({
    description:
      "在工作区根运行项目检查命令(类型检查/静态检查/测试,如 tsc --noEmit、eslint、vitest run)," +
      "把 stdout/stderr 和退出码返回给你。用 local_file 的 create/edit 修改工程文件后必须调用本工具" +
      "验收:检查失败就修复并复跑,直到 exitCode=0 才能向用户宣称完成。仅支持白名单内的纯检查命令" +
        `(自动执行,无需用户确认):${CHECK_ALLOWLIST_HINT};其他命令会被拒绝,请改用 local_file exec。`,
    inputSchema: projectCheckInputSchema,
  })
}

/** 注入 system prompt 的使用规则段 */
export const PROJECT_CHECK_TOOL_PROMPT: string = [
  "## 项目检查（project_check 工具,仅桌面端且已开启本地工作区时可用）",
  "- 用 local_file 的 create/edit 修改了工作区内的工程文件(代码/配置)后,收工前必须调用本工具" +
    "运行项目检查核实——exitCode≠0 就逐条修复,修完复跑,直到 exitCode=0 才能向用户宣称完成;" +
    "不要在未跑绿的情况下说「已完成/没问题」。",
  "- 白名单纯检查命令自动执行:" + CHECK_ALLOWLIST_HINT + "。npx 形式必须是 npx --no-install <检查器>" +
    "(只解析本地依赖,未安装会报错,不会联网下载);npm install、npx install、管道、重定向、绝对路径" +
    "等一律不在白名单——确需运行时改用 local_file 的 exec 动作(会弹确认卡等用户批准)。",
  "- 命令的工作目录=工作区根。TypeScript 项目用 tsc --noEmit(本地已装)或 npx --no-install tsc --noEmit;" +
    "大项目编译慢,按体量传 timeout_ms(如 120000)。",
  "- exitCode=-1 表示超时被强杀:核对输出后预估更长 timeout_ms 重试,或改跑更小范围的检查。",
  "- 检查通过只保证「代码能过类型/静态检查」这一层,仍需逐条对照用户的完整需求;两者都满足才算完成。",
].join("\n")
