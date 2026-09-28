import { LOCAL_FILE_TOOL_NAME } from "./local-file-tool"
import { PROJECT_CHECK_TOOL_NAME } from "./project-check-tool"

/**
 * 收工验收门（verify-gate，纯函数 isomorphic）—— ZCode Stop-hook 验证门语义的前端移植。
 *
 * 解决的问题：agent 用 local_file create/edit 成功改过工作区文件后,可以不跑任何检查、
 * 直接输出一段"已完成"文本收工。本模块判定"该不该打回"：本回合(最后一条真实用户消息
 * 之后)存在成功落盘的写入、且其后没有任何一次 exitCode=0 的 project_check → shouldGate。
 * ChatPanel 在亲眼见证一轮流式结束(status 回 ready)时调用,命中则注入一条
 * VERIFY_GATE_TAG 开头的 user 消息打回(上限 2 次,由调用方计数)。
 *
 * 边界(v1,与 ZCode 门一致):
 * - code_edit 不计入写:它产出的是代码面板待审查 Diff,落盘与否取决于用户采纳,
 *   自动打回会误伤"等用户审查"的合法停点;
 * - local_file delete/exec 不计入写:delete 有确认卡,exec 白名单外需批准;
 * - 门消息以 VERIFY_GATE_TAG 开头,边界扫描会跳过它——门打回后旧写入保持被追踪,
 *   直到出现一次跑绿的检查或用户发起新回合。
 */

export const VERIFY_GATE_TAG = "【验收门】"

/** 结构化最小视图(与 AI SDK v5 UIMessage 结构兼容,便于单测) */
export interface GateMessageLike {
  id?: string
  role?: string
  parts?: Array<{
    type?: string
    state?: string
    input?: unknown
    output?: unknown
    text?: string
  }>
}

export interface GateVerdict {
  shouldGate: boolean
  /** 未验收的写入文件路径(去重,最多 5 条,用于打回消息正文) */
  unverifiedWrites: string[]
}

/** 判断某条消息是否为验收门注入(打回消息以固定标签开头) */
export function isVerifyGateMessage(m: GateMessageLike): boolean {
  if (m.role !== "user") return false
  return m.parts?.some(
    (p) => p.type === "text" && typeof p.text === "string" && p.text.startsWith(VERIFY_GATE_TAG)
  ) ?? false
}

/** local_file 中算"写入"的动作(与文件头边界说明同步) */
const GATE_WRITE_ACTIONS = new Set(["create", "edit"])

/**
 * 分析本回合是否需要验收打回。
 * 边界=最后一条「真实」用户消息(跳过门注入消息);从边界向后线性扫描:
 * 成功写入 pending+1,一次 exitCode=0 的 project_check 把 pending 清零——
 * 「先写、后查绿、再写」的回合只对最后一次写入之后的空白负责。
 */
export function analyzeTurnForGate(messages: GateMessageLike[]): GateVerdict {
  let boundary = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== "user") continue
    if (isVerifyGateMessage(m)) continue
    boundary = i
    break
  }
  // 没有真实用户消息(空会话/纯历史回放)不打回
  if (boundary === -1) return { shouldGate: false, unverifiedWrites: [] }

  let pending = 0
  const unverified: string[] = []
  for (let i = boundary + 1; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== "assistant") continue
    for (const part of m.parts ?? []) {
      const t = part.type ?? ""
      if (!t.startsWith("tool-")) continue
      // 只认已回填结果的调用;input-available 悬空态由续跑机制处理,不归门管
      if (part.state !== "output-available") continue
      if (t === `tool-${PROJECT_CHECK_TOOL_NAME}`) {
        const out = part.output as { ok?: boolean; exitCode?: number } | undefined
        if (out?.ok === true && out.exitCode === 0) {
          pending = 0
          unverified.length = 0
        }
        continue
      }
      if (t === `tool-${LOCAL_FILE_TOOL_NAME}`) {
        const input = part.input as { action?: string; path?: string } | undefined
        const output = part.output as { ok?: boolean; denied?: boolean } | undefined
        if (
          input?.action &&
          GATE_WRITE_ACTIONS.has(input.action) &&
          output?.ok === true &&
          output.denied !== true
        ) {
          pending += 1
          if (typeof input.path === "string" && input.path) unverified.push(input.path)
        }
      }
    }
  }
  return { shouldGate: pending > 0, unverifiedWrites: Array.from(new Set(unverified)).slice(0, 5) }
}

/** 构造打回消息正文(以 VERIFY_GATE_TAG 开头,调用方原样作为 user 消息发送) */
export function buildVerifyGateMessage(writes: string[]): string {
  const list = writes.length > 0 ? `(涉及:${writes.join("、")})` : ""
  return (
    VERIFY_GATE_TAG +
    ` 你本回合修改了工作区文件但尚未运行 project_check 或尚未跑绿${list},` +
    "不能就此收工。请立即调用 project_check 运行项目检查命令;" +
    "若检查失败,先修复再复跑,直到 exitCode=0,然后如实向用户汇报结果。"
  )
}
