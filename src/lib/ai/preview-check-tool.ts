import { tool } from "ai"
import { z } from "zod"

/**
 * 预览验证工具（preview_check）—— AI 主动验证自己写的 HTML 代码。
 *
 * 解决的问题：AI 写完网页后是"盲写"——页面白屏、JS 报错、console 异常，只有用户看得到，
 * AI 自己不知道。本工具让 AI 在 write_code / code_edit 之后主动调用：前端把文档切到
 * 预览渲染，注入的错误捕获脚本收集 console.error / 页面脚本错误 / Promise 未处理拒绝，
 * 回填给模型 —— 模型看到报错 → 修代码（code_edit）→ 再查一遍，形成自动验证闭环。
 *
 * 与 local_file / code_edit 同属"无 execute 客户端工具"：服务端只发 tool-call 即停步
 * （stopWhen 已加本工具名），前端 ChatPanel.onToolCall 拦截执行，addToolOutput 回填，
 * sendAutomaticallyWhen 触发同轮续跑。不依赖 Tauri，Web 端同样可用。
 *
 * 捕获原理：iframe sandbox 为 "allow-scripts allow-forms allow-popups" 且无
 * allow-same-origin（opaque origin），页面脚本摸不到父页面，只能
 * window.parent.postMessage 上报；父页面按 source 字段校验后入 store 缓冲。
 */

export const PREVIEW_CHECK_TOOL_NAME = "preview_check"

export const previewCheckInputSchema = z.object({
  docId: z
    .string()
    .optional()
    .describe(
      "要验证的代码文档 id。刚用 write_code 创建或 code_edit 修改后可不传（默认验证当前打开的文档）；" +
        "验证其他文档时传对应 id。"
    ),
})

/** 前端回填给模型的结果形状（随消息 metadata.toolCalls 持久化） */
export interface PreviewCheckToolOutput {
  ok: boolean
  /** 实际验证的文档 id（成功时） */
  docId?: string
  /** 捕获到的错误条数 */
  errorCount?: number
  /** 错误明细（最多 20 条，每条截断到 500 字符） */
  errors?: string[]
  /** 失败/不可验证的原因（回传给模型，让它如实向用户解释） */
  message?: string
}

/** 未知形状收窄:卡片/历史回放时判断 output 是否为预览验证结果 */
export function isPreviewCheckOutput(o: unknown): o is PreviewCheckToolOutput {
  return !!o && typeof o === "object" && "ok" in (o as Record<string, unknown>)
}

/** 创建预览验证工具（无 execute，执行在前端：见文件头注释） */
export function createPreviewCheckTool() {
  return tool({
    description:
      "验证代码文档的 HTML 预览是否正常渲染：前端会实际渲染页面并收集 console 报错、脚本异常、" +
      "未处理的 Promise 拒绝，把错误清单返回给你。写完或修改 HTML 文档后调用本工具自查，" +
      "收到报错就用 code_edit 修复后再次验证，直到无报错为止。仅支持 html 语言文档。",
    inputSchema: previewCheckInputSchema,
  })
}

/** 注入 system prompt 的使用规则段 */
export const PREVIEW_CHECK_TOOL_PROMPT: string = [
  "## 预览验证（preview_check 工具）",
  "- 用 write_code 创建 HTML 文档、或用 code_edit 修改 HTML 文档后，主动调用本工具验证渲染效果：它会真实渲染页面并把 console 报错/脚本异常收集给你。",
  "- 收到 errors 非空时，逐条分析并用 code_edit 修复，然后再次调用本工具复查，直到 errorCount 为 0；不要在未验证通过时向用户声称\"页面正常\"。",
  "- errorCount 为 0 说明渲染无脚本报错（不代表视觉设计完美，布局微调仍可结合用户反馈）。",
  "- 非 HTML 文档会返回不可验证，不要对其他语言反复重试本工具。",
  "- 一次验证通常 3~8 秒，多轮\"修改→验证\"是正常工作流，不要因为要验证而跳过修改。",
].join("\n")

/** postMessage 上报的 source 标识（父页面据此过滤无关 message） */
export const PREVIEW_CAPTURE_SOURCE = "aichatt-preview-capture"

/** 单条上报文本上限（父页面入库前还会再截到 500） */
const CAPTURE_TEXT_MAX = 2000

/**
 * 错误捕获 bootstrap（注入进 srcDoc 头部）：
 * 覆写 console.error + 监听 window error / unhandledrejection，
 * 经 parent.postMessage 上报。注意脚本内不得出现字面 "</script>"（会提前终止标签）。
 */
const CAPTURE_BOOTSTRAP = `<script>(function(){
var SOURCE=${JSON.stringify(PREVIEW_CAPTURE_SOURCE)};
function send(text){
  try{parent.postMessage({source:SOURCE,text:String(text).slice(0,${CAPTURE_TEXT_MAX})},'*')}catch(e){}
}
function fmt(v){try{
  if(typeof v==='string')return v;
  if(v instanceof Error)return v.stack||v.message;
  var s=JSON.stringify(v);return s===undefined?String(v):s;
}catch(e){return String(v)}}
var origError=console.error.bind(console);
console.error=function(){var a=[].slice.call(arguments);
  send(a.map(fmt).join(' '));origError.apply(null,a)};
window.addEventListener('error',function(e){
  var m=e&&e.message?e.message:'脚本错误';
  if(e&&e.lineno)m+=' (行'+e.lineno+':'+e.colno+')';
  send(m)});
window.addEventListener('unhandledrejection',function(e){
  var r=e&&e.reason;send('Unhandled Promise rejection: '+(r instanceof Error?(r.stack||r.message):String(r)))});
})();</script>`

/**
 * 给 HTML 源码注入捕获脚本（<head>/<html> 后插入，裸片段则前置）。
 * 所有预览渲染统一走此入口 —— 捕获是被动旁路，不改变页面逻辑；
 * 用户手动预览时同样收集错误（供错误角标与「把报错发给 AI」按钮使用）。
 */
export function buildPreviewSrcWithCapture(code: string): string {
  if (/<head[^>]*>/i.test(code)) return code.replace(/<head[^>]*>/i, (m) => m + CAPTURE_BOOTSTRAP)
  if (/<html[^>]*>/i.test(code)) return code.replace(/<html[^>]*>/i, (m) => m + CAPTURE_BOOTSTRAP)
  return CAPTURE_BOOTSTRAP + code
}
