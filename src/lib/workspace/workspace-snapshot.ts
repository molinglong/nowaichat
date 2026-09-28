import { overviewDir, readFile, getWorkspaceDir } from '@/lib/tauri-files'

/**
 * 工作区快照（客户端组装,跨请求注入 system prompt）—— 参照 ZCode 的 AGENTS.md +
 * 项目记忆双通道,按本项目架构做客户端化:工作区绝对路径只存在于桌面端 Rust 配置
 * (服务器永远拿不到),所以快照由前端组装后随请求 body 上报,服务端只做注入。
 *
 * 内容:
 * - 目录树(lf_overview,3 层深,自动跳过 node_modules/.git)≤4KB —— 省去模型每会话
 *   重新 overview 的一步,也让 AI 一开口就知道项目长什么样;
 * - AGENT.md(工作区根的项目约定文件,≤6KB)—— 用户手写或 AI 按建议写入的项目规范,
 *   每次会话自动生效(ZCode workspace AGENTS.md 的对应物)。
 *
 * 缓存策略:60s TTL + 写类 local_file 操作后主动失效重建(ChatPanel 触发)。
 * 快照天然可能滞后,服务端注入时会带上「可能滞后,改文件前先核实」的提示。
 */

/** 目录树上限(超过直接截断,树本身 3 层深一般远小于此) */
const TREE_MAX = 4 * 1024
/** AGENT.md 上限 */
const AGENT_MD_MAX = 6 * 1024
/** 服务端整段注入上限(防两段拼接超预算) */
const SNAPSHOT_MAX = 8 * 1024
/** 缓存有效期 */
const TTL_MS = 60_000
/** 约定文件名(工作区根):用户手写项目约定,AI 也会被引导写入 */
export const WORKSPACE_AGENT_FILE = 'AGENT.md'

const cache: { text: string | null; builtAt: number } = { text: null, builtAt: 0 }

/** 读取当前快照(同步,transport body getter 用);未构建/过期未重建时返回上次结果 */
export function getWorkspaceSnapshot(): string | null {
  return cache.text
}

/**
 * 组装快照:仅 Tauri + 已授权工作区时有值;其余环境返回 null(transport getter 返回 undefined,
 * 服务端不注入)。任何失败静默降级为 null —— 快照是增强项,绝不能干扰聊天主链路。
 */
export async function refreshWorkspaceSnapshot(): Promise<void> {
  try {
    // 非 Tauri(网页端)时 getWorkspaceDir 返回 null,快照为空 —— 注入与工作区工具同源
    const base = await getWorkspaceDir()
    if (!base) {
      cache.text = null
      return
    }
    const parts: string[] = []

    // 目录树:overview 根目录(3 层深)
    try {
      const ov = await overviewDir('')
      if (ov.ok && ov.text) {
        const tree = ov.text.length > TREE_MAX ? ov.text.slice(0, TREE_MAX) + '\n…(已截断)' : ov.text
        const stat = `共 ${ov.totalFiles ?? '?'} 文件 / ${ov.totalDirs ?? '?'} 目录`
        parts.push(`### 目录树(${stat}${ov.truncated ? ',原始输出被截断' : ''})\n\`\`\`\n${tree}\n\`\`\``)
      }
    } catch {
      // overview 失败不阻塞 AGENT.md
    }

    // AGENT.md 项目约定(读不到=用户还没写,正常,静默跳过)
    try {
      const md = await readFile(WORKSPACE_AGENT_FILE)
      if (md.ok && md.content && md.content.trim()) {
        const body =
          md.content.length > AGENT_MD_MAX
            ? md.content.slice(0, AGENT_MD_MAX) + '\n…(已截断)'
            : md.content
        parts.push(`### ${WORKSPACE_AGENT_FILE}(项目约定)\n${body}`)
      }
    } catch {
      // 无约定文件,跳过
    }

    cache.text = parts.length > 0 ? parts.join('\n\n').slice(0, SNAPSHOT_MAX) : null
    cache.builtAt = Date.now()
  } catch {
    // 全链路兜底:快照失败对聊天零影响
  }
}

/** 过期则重建(挂载/handleSend 时调用,fire-and-forget);TTL 内直接复用缓存 */
export async function ensureWorkspaceSnapshot(): Promise<void> {
  if (Date.now() - cache.builtAt < TTL_MS && cache.builtAt > 0) return
  await refreshWorkspaceSnapshot()
}
