import { tool } from "ai"
import { z } from "zod"

/**
 * 代码编辑器工具（code_edit）—— AI 修改用户在代码编辑器面板中打开的代码文档。
 *
 * 与 local_file 的关键差异:本工具不碰用户磁盘,操作的是数据库里的 CodeDoc
 * (代码编辑器面板的文档)。AI 发出 old_text/new_text 后,前端 onToolCall 拦截:
 * 取文档当前真实内容 → 按 code-edit-match.ts 做唯一匹配(精确 → 逐行 trim 两级) →
 * 应用替换算出 modified → 写入 chat-store.codePendingDiff,代码编辑器切 Diff 审查模式
 * (左:文档真实当前内容 / 右:应用片段替换后的版本),用户「采纳」才覆盖全文并自动保存,
 * 「放弃」则丢弃。工具本身无 execute(同 local_file 架构):服务端不碰数据,前端拦截执行,
 * addToolOutput 回填,sendAutomaticallyWhen 触发同轮续跑。
 *
 * 编辑语义(参照 ZCode Edit):old_text/new_text 是「片段」而非整篇 —— 模型只发要改的
 * 代码块及其前后几行上下文,唯一命中才应用;0 处/多处都会回填可行动错误让模型重试。
 * 片段级编辑比整篇重写省 token、不会碰坏文档其余部分,大文档也能改(不受 30K 限制)。
 * 兼容:old_text 恰为全文时等同于整篇替换(旧请求形状自然兼容);文档为空时 old_text
 * 可为空(整篇写入)。replace_all=true 替换全部精确命中(片段定位模糊回退禁用)。
 */

export const CODE_EDIT_TOOL_NAME = "code_edit"

export const codeEditInputSchema = z.object({
  docId: z
    .string()
    .describe(
      "要修改的代码文档 id(用户在「让 AI 改这段」时随请求一起告知,见用户消息)。必须是用户当前打开的文档 id。"
    ),
  old_text: z
    .string()
    .describe(
      "要被替换的原文片段——从用户消息给出的当前代码里逐字复制(含缩进/标点),且在整篇文档中只出现一次。" +
        "取要修改的代码块及其前后 1~3 行上下文即可,不必整篇;" +
        "仅当文档为空(新建内容)时才允许传空字符串。"
    ),
  new_text: z
    .string()
    .describe("替换后的新片段。保持与原文相同的缩进风格;只改需求涉及的部分,无关代码原样保留。"),
  replace_all: z
    .boolean()
    .optional()
    .describe(
      "仅当要替换的片段在文档中多处出现且确需全部替换时传 true(按精确匹配全部替换);默认 false。"
    ),
})

export type CodeEditToolInput = z.infer<typeof codeEditInputSchema>

/**
 * 前端回填给模型的结果形状。会随消息 metadata.toolCalls 持久化。
 * status 流转:pending-review(默认,等用户审查)→ 无后续自动回填
 * (AI 本轮流在收到 pending-review 后正常收尾即可,审查是用户后续动作)。
 */
export interface CodeEditToolOutput {
  ok: boolean
  /** pending-review=已展示 Diff 等用户审查;accepted=用户已采纳;rejected=用户已放弃 */
  status?: "pending-review" | "accepted" | "rejected"
  /** 本次实际使用的匹配策略(成功时回传,提示模型片段定位情况) */
  strategy?: "exact" | "line-trimmed"
  error?: string
}

/**
 * 创建代码编辑工具（无 execute,见文件头注释）
 */
export function createCodeEditTool() {
  return tool({
    description:
      "修改用户在「代码编辑器」面板里打开的代码文档(操作的是面板内的 CodeDoc,不碰用户磁盘)。" +
      "场景:用户在代码编辑器里点「让 AI 改这段」,把当前代码与改写需求发给你;" +
      "你据此用片段级替换修改:old_text=原文中要被替换的片段(逐字复制、全文唯一)," +
      "new_text=改写后的片段。前端会把替换前后的完整文档以 Diff 展示给用户,用户点「采纳」才真正写回。" +
      "【注意】old_text 必须从用户消息里的当前代码逐字复制,不要凭记忆改写;一次调用只改一处片段;" +
      "不要臆造未展示给用户的 docId。",
    inputSchema: codeEditInputSchema,
  })
}

/**
 * 注入 system prompt 的使用规则段。
 */
export const CODE_EDIT_TOOL_PROMPT: string = [
  "## 代码编辑器修改（code_edit 工具）",
  "- 用户在「代码编辑器」面板写代码时,可点「让 AI 改这段」把当前代码与需求发给你,期望你返回修改。",
  "- 收到此类请求时,用 code_edit 工具做片段级替换:docId(用户消息里给的文档 id)、" +
    "old_text(从用户消息的当前代码里逐字复制的要改片段,带前后 1~3 行上下文保证全文唯一)、" +
    "new_text(改写后的片段)。不要整篇重发——只发改动涉及的片段。",
  "- old_text 必须逐字一致(含缩进/标点),基于用户消息里的原文,不要凭记忆改写;" +
    "匹配不到或多处命中都会被拒绝并提示,按提示加长上下文重试即可。",
  "- 只改需求涉及的部分,无关代码原样保留;保持代码可运行:补全语法、不破坏原有 import/结构,语言与原文档一致。",
  "- 若同一片段在文档多处出现且确需全部替换,传 replace_all: true;否则加长片段唯一定位。",
  "- 工具结果会是 pending-review(已展示 Diff 给用户审查),你据此向用户说明改了什么、为什么;用户是否采纳是后续动作,不要假装已写入。",
  "- 修改 HTML 文档后建议调 preview_check 复查渲染;报错未清零前不要声称「已修复」,如实向用户汇报当前状态。",
].join("\n")
