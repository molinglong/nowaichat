import { z } from "zod"
import { CODE_LANGUAGE_IDS } from "@/lib/code/doc-input"

/**
 * 代码文档工具（write_code）
 *
 * 设计目标：用户在聊天里要一份「可执行/机器可读的代码产物」时（网页 HTML、
 * 脚本、组件、配置文件等），模型把完整代码创建为「代码编辑器」面板里的
 * 代码文档，聊天流内渲染一张卡片，前端自动滑出右侧 Monaco 面板继续编辑 ——
 * 与 write_document（写作画布，人读的文字成品）严格分工，根治
 * 「说写个主页 html 却被写进写作画布」的高频误路由。
 *
 * 与 write_document 的对照：同样有 execute 直接落库（CodeDoc 表），成功即
 * 自动打开面板；校验口径与 /api/code/docs REST 完全一致
 * （normalizeWriteTitle / normalizeCodeLanguage 同一函数）。
 *
 * 与 code_edit 的差异：code_edit 是「改用户已在面板打开的文档」（无 execute，
 * 走 Diff 审查）；本工具是「新建代码文档」，两者互补、互不替代。
 *
 * 与 local_file.create 的差异：本工具只建编辑器文档（数据库），不碰用户
 * 磁盘；用户明确要求把文件落到本地工作区磁盘时走 local_file（仅桌面客户端）。
 * 本文件纯常量无服务端依赖，客户端组件可安全 import。
 */

export const WRITE_CODE_TOOL_NAME = "write_code"

/** AI 创建代码文档的 schema（值限制与 /api/code/docs 校验对齐 + describe 指引；conversationId 由服务端注入，不经模型） */
export const writeCodeToolSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("代码文档标题，取文件名风格（如 coffee-homepage.html、scraper.py），最多 100 字；不填默认「未命名」"),
  language: z
    .enum(CODE_LANGUAGE_IDS)
    .default("typescript")
    .describe("语言标识（决定编辑器语法高亮），如 html/css/javascript/typescript/python/json"),
  content: z
    .string()
    .trim()
    .min(1)
    .max(30000)
    .describe("完整、可直接运行的代码正文；不要包含 Markdown 代码围栏（```），不要包含任何解释文字"),
})

/** 工具输出（卡片据 ok 分支渲染成功/失败） */
export type WriteCodeToolOutput =
  | { ok: true; docId: string; title: string; language: string; charCount: number }
  | { ok: false; message: string }

/** 未知形状收窄：卡片/历史回放时判断 output 是否为成功的代码文档创建结果 */
export function isWriteCodeOutput(o: unknown): o is WriteCodeToolOutput {
  return (
    !!o &&
    typeof o === "object" &&
    "ok" in o &&
    typeof (o as { ok: unknown }).ok === "boolean"
  )
}

/** 注入 system prompt 的使用规则段 */
export const WRITE_CODE_TOOL_PROMPT: string = [
  "## 代码文档（write_code 工具）",
  "- 用户要一份「完整的代码产物」时，调用本工具把代码创建为「代码编辑器」中的文档：HTML 网页（主页/落地页/网站首页/博客页/活动页）、CSS/JS/TS/React/Vue、Python/Rust/Go/Java 等任意语言、配置文件（json/yaml/toml）、脚本（.sh/.ps1/.sql）",
  "- 判断口诀：含 <html/<script/<style/import/export/function /class /def /const /let 等代码特征，或用户说「写个主页/网页/组件/脚本/程序」→ 调用本工具；**这是「写个 xx 主页/网页」类请求的默认去处，不要写进写作画布**",
  "- 代码只写进工具参数，聊天回复里最多一句引入语（如「已写好，点卡片在代码编辑器中打开」），绝不要在聊天里重复整篇代码",
  "- 正文必须是完整可直接运行的代码，不要包含 Markdown 代码围栏（```），不要有解释或元话语",
  "- 「人读的文字成品」（小说/故事/作文/演讲稿/公众号文章/小红书笔记）走写作画布的 write_document，不要用本工具",
  "- 问答/解释里附带的几行示例代码片段直接聊天里用代码块回复即可，不必建文档；用户明确要一份可运行的完整代码时才调用",
  "- 需要把文件写入用户本地工作区磁盘时（桌面客户端），用 local_file 工具；本工具只创建编辑器文档（用户可在编辑器里导出到工作区），未打开代码面板时也照常调用，前端会自动打开面板",
].join("\n")
