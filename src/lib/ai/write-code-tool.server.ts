import { tool } from "ai"
import { prisma } from "@/lib/db"
import { normalizeWriteTitle } from "@/lib/write/doc-input"
import { normalizeCodeLanguage } from "@/lib/code/doc-input"
import { writeCodeToolSchema, type WriteCodeToolOutput } from "@/lib/ai/write-code-tool"

/**
 * write_code 工具工厂（服务端专用，依赖 prisma；勿从客户端组件 import）。
 * 常量与 schema 在 write-code-tool.ts（isomorphic），拆分原因见该文件头注释。
 *
 * 与 REST API（/api/code/docs）共用 CodeDoc 表与校验口径
 * （normalizeWriteTitle / normalizeCodeLanguage 同一函数）。
 * conversationId 由工厂闭包注入（chat 路由解析出会话后传入），不暴露给模型；
 * 代码文档列表因此按会话聚合展示。
 */

/** 兜底剥离模型误带的 Markdown 围栏（```lang ... ```）——代码正文最常见污染 */
function stripCodeFence(raw: string): string {
  const m = raw.match(/^```[\w.+-]*\r?\n([\s\S]*?)\r?\n?```$/)
  return m ? m[1] : raw
}

export function createWriteCodeTool(userId: string, conversationId?: string) {
  return tool({
    description:
      "把完整的代码/网页产物（HTML/CSS/JS/TS、Python 等任意语言、配置文件、脚本）创建为用户「代码编辑器」中的代码文档，" +
      "前端会自动滑出右侧代码面板（Monaco 语法高亮）打开它。用户要求写网页/主页/代码时调用本工具；" +
      "人读的文字成品（小说/作文/文案）走 write_document；问答式示例代码片段不要调用。",
    inputSchema: writeCodeToolSchema,
    execute: async ({ title, language, content }): Promise<WriteCodeToolOutput> => {
      const body = stripCodeFence(content.trim()).trim()
      if (!body) {
        return { ok: false, message: "代码内容为空" }
      }
      try {
        const doc = await prisma.codeDoc.create({
          data: {
            userId,
            title: normalizeWriteTitle(title),
            content: body,
            language: normalizeCodeLanguage(language),
            charCount: body.length,
            // 来源会话由服务端注入(不信任模型回传,模型传了也以此为准),列表按会话聚合
            conversationId: conversationId ?? null,
          },
          select: { id: true, title: true, language: true, charCount: true },
        })
        return {
          ok: true,
          docId: doc.id,
          title: doc.title,
          language: doc.language,
          charCount: doc.charCount,
        }
      } catch {
        return { ok: false, message: "代码文档保存失败，请稍后重试" }
      }
    },
  })
}
