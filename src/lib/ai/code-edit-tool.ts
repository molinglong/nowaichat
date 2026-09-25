import { tool } from "ai"
import { z } from "zod"

/**
 * 代码编辑器工具（code_edit）—— AI 修改用户在代码编辑器面板中打开的代码文档。
 *
 * 与 local_file 的关键差异:本工具不碰用户磁盘,操作的是数据库里的 CodeDoc
 * (代码编辑器面板的文档)。AI 发出 old_text/new_text 后,前端 onToolCall 拦截,
 * 把 {docId, original, modified} 写入 chat-store.codePendingDiff,代码编辑器
 * 切到 Diff 审查模式(左原文 / 右 AI 版本),用户「采纳」才用 modified 覆盖
 * 全文并自动保存,「放弃」则丢弃。工具本身无 execute(同 local_file 架构):
 * 服务端不碰数据,前端拦截执行,addToolOutput 回填「待审查」结果。
 *
 * 约定:old_text/new_text 均为该文档的「完整代码」(非片段),采纳即整篇替换,
 * 避免在文档内做片段定位拼接的复杂度与歧义。
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
      "该文档的当前完整代码原文(逐字复制,作为 Diff 审查的左侧基准)。务必与用户给出的原文完全一致。"
    ),
  new_text: z
    .string()
    .describe(
      "修改后的完整代码(作为 Diff 审查的右侧版本)。用户在编辑器里审查后点「采纳」才会用它整篇覆盖原文。"
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
      "你据此产出修改后的完整代码,用本工具返回(old_text=用户给的原文,new_text=你的新版本,docId=用户给的文档 id)。" +
      "前端会把 old/new 以 Diff 审查模式展示给用户,用户点「采纳」才真正写回。" +
      "【注意】old_text 与 new_text 都必须是该文档的完整代码,不要只给片段;" +
      "不要臆造未展示给用户的 docId;一次只改一篇文档。",
    inputSchema: codeEditInputSchema,
  })
}

/**
 * 注入 system prompt 的使用规则段。
 */
export const CODE_EDIT_TOOL_PROMPT: string = [
  "## 代码编辑器修改（code_edit 工具）",
  "- 用户在「代码编辑器」面板写代码时,可点「让 AI 改这段」把当前代码与需求发给你,期望你返回修改后的代码。",
  "- 收到此类请求时,用 code_edit 工具返回:docId(用户消息里给的文档 id)、old_text(用户消息里给的原文,逐字复制)、new_text(你改写后的完整代码)。",
  "- old_text / new_text 必须是完整代码(整篇),不要只给改动的片段——前端以整篇 Diff 展示,采纳即整篇覆盖。",
  "- 改写要贴合用户需求:若用户指明了选中区域,重点改那部分并保持其余稳定;不要擅自扩大改动范围或重写无关逻辑。",
  "- 保持代码可运行:补全语法、不破坏原有 import/结构,语言与原文档一致。",
  "- 工具结果会是 pending-review(已展示给用户审查),你据此向用户说明改了什么、为什么;用户是否采纳是后续动作,不要假装已写入。",
  "- 不要臆造 docId,只用用户消息里给出的那个;一篇文档一次只调一次 code_edit。",
].join("\n")
