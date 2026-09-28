# aichatt 能干活改造 · P0:验证闭环(收工验收门)

## 目标
治最大短板:agent 改完本地工程文件后不验证就自称完成。做法 = 新增 `project_check` 客户端工具 + 收工硬门。语义与已在 ZCode 侧 E2E 验证过的 verify-gate 完全同构,但实现全部落在 aichatt 代码内,**纯 TS,零 Rust 改动**。

## 已探明的技术地基(无需重复验证)
- `lf_exec`(src-tauri/src/lib.rs:1237)现成:powershell 受控执行、50ms 轮询超时 + taskkill 强杀进程树、UTF-8 输出、32KB 头尾保留截断、`lf_safe_join` 目录逃逸防护
- 客户端工具三件套模式成熟(工具无 execute → route `stopWhen` 停步 → `ChatPanel.onToolCall` 拦截 → `addToolOutput` 回填 → `sendAutomaticallyWhen` 判据续跑),preview_check/local_file 同款
- `isExecAutoAllowed` + 确认卡黑名单 `EXEC_CONFIRM_PATTERNS`(src/lib/ai/local-file-tool.ts:329-376)可复用
- v5 协议 output 包裹规则 route.ts:202-207 已处理;`onStepFinish → collectedToolCalls → metadata` 持久化链路现成

## 设计决策(按推荐定,可否决)
1. `project_check` 独立工具(非 local_file 的 action):独立门语义/卡片/提示词,沿 preview_check 先例
2. **命令放行 = 纯检查器白名单**:首词 ∈ {tsc, eslint, vitest, jest, pytest, cargo check, go vet, node --test, rstest} 自动执行(仍须全文不命中 `EXEC_CONFIRM_PATTERNS` 黑名单,挡管道/重定向/`;`/`$()`/绝对路径);npm/npx **不进**白名单(装包 = 任意 postinstall 脚本风险);其余命令不硬跑,回填提示改用 `local_file exec`(走既有确认卡)
3. **收工门 = 硬门**:本回合有"写且成功"的 tool-call 但无 project_check 跑绿记录、模型以文本收尾 → 自动发一条标明的【验收门】消息打回(上限 2 次,防循环);用户发言后计数重置
4. 门只认:local_file create/edit 且 output.ok、code_edit 且 output.ok;delete(需确认)与 exec 不算写(v1 边界,文档记录)

## 实施步骤

### 1. 新文件 `src/lib/ai/project-check-tool.ts`
- `PROJECT_CHECK_TOOL_NAME`、`tool({description, inputSchema})` 无 execute;input:`{ command: string, timeout_ms?: ≤180000 }`
- 导出纯函数 `isCheckCommandAllowed(cmd)`:首词白名单 + 黑名单过滤(复用 EXEC_CONFIRM_PATTERNS)
- `PROJECT_CHECK_TOOL_PROMPT`:改完本地文件必须跑、exitCode=0 才算过、失败先修再复跑、非白名单命令换 local_file exec
- 输出接口 `{ ok, exitCode, output, truncated, durationMs, denied?, error? }`

### 2. 新文件 `src/lib/ai/verify-gate.ts`
- 导出纯函数 `analyzeTurnForGate(messages)` → `{ shouldGate, unverifiedWrites[] }`:扫描最后一条 user 消息之后的 assistant 消息,存在 ok 的写类 tool-call 且其后无 exitCode===0 的 project_check output → shouldGate
- 复用 route.ts:180-218 的 part 类型判读方式

### 3. `src/components/chat/ChatPanel.tsx`
- `onToolCall` 加 project_check 分支:去重 ref → 非 Tauri / 无工作区(lf_get_base)回填明确错误 → `isCheckCommandAllowed` 不通过回填拒绝 → 通过则 `lfExecCommand(cmd, timeout)` → `addToolOutput`
- 收工门:消息订阅(或 onFinish 处,注意 :919 跳过 DB 同步的轮次逻辑不被门消息破坏)——`analyzeTurnForGate` 为真且 gateCount<2 → `sendMessage` 注入【验收门】消息;新 user 消息重置计数;`localFilesEnabled=false` 时门整体不启用

### 4. `src/app/api/chat/route.ts`
- 挂载闸门 = `body.localFilesEnabled === true && !isEphemeral && !groupId`(与 local_file 同闸,桌面端才有 lf_exec);`systemParts.push(PROJECT_CHECK_TOOL_PROMPT)`;`stopWhen` 客户端工具数组加 `PROJECT_CHECK_TOOL_NAME`

### 5. `src/components/chat/ToolCallCard.tsx`
- project_check 卡片分支:命令文本 + exitCode 徽章(绿/红)+ 折叠输出(复用 exec 样式)

### 6. 测试与手测
- 单测:`isCheckCommandAllowed`(白名单命中 / `tsc && rm -rf /`、管道、绝对路径拦截 / npm install 拒绝)、`analyzeTurnForGate`(有写无验收 / 有写+check 绿 / denied 写 / 门消息后再犯 / 上限)
- 手测(桌面端 dev):让 agent 改本地 ts 文件 → 收工被门打回 → 自跑 project_check 看到真实 TS 错误 → 修复 → 复跑绿 → 正常收工;全程用户零点击

## 已知边界(v1,写入代码注释)
- exec 动作改文件不计为"写"(读命令白名单占绝对多数);Web 端整体不启用;tsc 全量 ~25s,门最多触发 2 次续跑,成本可控

## 后续(本次不做)
P1 = agent 任务清单工具 + 收尾核对(现有 manage_todo 是用户生活待办,非工作分解);P2 = soulecho 中转 terra/astra 档位进 aichatt provider 设置