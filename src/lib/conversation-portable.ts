import { prisma } from '@/lib/db'

/**
 * 会话搬运内核 —— 导出一侧序列化、导入一侧校验,两端共用同一份契约。
 *
 * 为什么要一份 JSON 契约而不是直接搬数据库:本地 dev 实例与线上实例是两套独立库,
 * 用户「不知不觉在本地聊完」之后需要把会话挪到线上,好让手机(连的是线上)接着用。
 * 数据库直连会碰生产库,是红线;所以走可离线、可复查、可回滚的文件流。
 *
 * 三条不可让的口径:
 * 1. id 沿用原值 —— cuid 全局唯一,它就是天然幂等键,重复导入不会产生第二份会话。
 * 2. userId 一律由导入端按当前登录者覆写,包里带的归属字段只当没看见。
 * 3. 附件只搬引用不搬文件(第一期)。文件躺在各自机器的 public/uploads 下,
 *    跟数据库不同源;导入时把引用摘掉并在 metadata 留一份「未迁移」凭据,
 *    宁可显示"这里原来有 2 个附件",也不留一个点开就 404 的死链。
 */

export const BUNDLE_KIND = 'aichat.conversation-bundle'
export const BUNDLE_VERSION = 1

/** 单次导入的会话条数上限:超出应分批,免得一个请求把 DB 事务拖到超时 */
export const MAX_CONVERSATIONS_PER_IMPORT = 200
/** 单条会话的消息行数上限(正常对话到不了这个量级,到了就是坏包或有人在塞数据) */
export const MAX_MESSAGES_PER_CONVERSATION = 5000
/** 单条消息正文上限:与常见长文回复同量级,超出即判为损坏 */
export const MAX_MESSAGE_CONTENT_LEN = 200_000
/** 标题上限,与新建对话的输入约束同口径 */
export const MAX_TITLE_LEN = 200

export interface PortableMessage {
  id: string
  role: string
  content: string
  reasoning: string | null
  model: string | null
  groupId: string | null
  /** 已 parse 成 JSON 值;库里是字符串,包里统一为对象/数组/null */
  metadata: unknown
  attachments: unknown
  promptTokens: number | null
  completionTokens: number | null
  archived: boolean
  archivedRoot: string | null
  createdAt: string
}

export interface PortableSummary {
  id: string
  rangeStart: string | null
  rangeEnd: string
  content: string
  modelId: string | null
  coveredMessages: number
  createdAt: string
}

export interface PortableVote {
  id: string
  groupId: string
  votedModel: string
  createdAt: string
}

export interface PortableConversation {
  id: string
  title: string
  model: string
  mode: string
  compareModels: string | null
  styleOffset: number
  stylePreset: string | null
  replyLength: string | null
  maskId: string | null
  createdAt: string
  updatedAt: string
  /** 未归档消息行数,纯给导入前的预览用,免得 UI 自己再数一遍数错 */
  messageCount: number
  /** 本条会话引用的附件个数(第一期一律不迁移) */
  attachmentCount: number
  messages: PortableMessage[]
  summaries: PortableSummary[]
  compareVotes: PortableVote[]
}

export interface ConversationBundle {
  kind: typeof BUNDLE_KIND
  version: number
  exportedAt: string
  /** 导出方的包版本,便于日后契约变更时判断该不该拒收 */
  appVersion?: string
  conversations: PortableConversation[]
}

/** 导出端点用到的行形状:会话列 + 消息 + 摘要 + 投票 */
export interface ConversationExportRows {
  id: string
  title: string
  model: string
  mode: string
  compareModels: string | null
  styleOffset: number
  stylePreset: string | null
  replyLength: string | null
  maskId: string | null
  createdAt: Date
  updatedAt: Date
  messages: Array<{
    id: string
    role: string
    content: string
    reasoning: string | null
    attachments: string | null
    metadata: string | null
    model: string | null
    groupId: string | null
    promptTokens: number | null
    completionTokens: number | null
    archived: boolean
    archivedRoot: string | null
    createdAt: Date
  }>
  summaries: Array<{
    id: string
    rangeStart: string | null
    rangeEnd: string
    content: string
    modelId: string | null
    coveredMessages: number
    createdAt: Date
  }>
  compareVotes: Array<{
    id: string
    groupId: string
    votedModel: string
    createdAt: Date
  }>
}

/**
 * 宽松解析库里的 JSON 字符串列:损坏一律退化为 null(与 formatMessageRow 同口径),
 * 不做抛错 —— 一个坏 metadata 不该让整条会话导不出来。
 */
function parseJsonColumn(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** 数一条消息的附件引用个数(只认带 url 的数组项) */
function countAttachments(parsed: unknown): number {
  if (!Array.isArray(parsed)) return 0
  return parsed.filter(
    (att) => att && typeof att === 'object' && typeof (att as { url?: unknown }).url === 'string'
  ).length
}

/** 会话行 → 包内条目(时间统一 ISO,JSON 列统一 parse) */
export function toPortableConversation(row: ConversationExportRows): PortableConversation {
  let attachmentCount = 0
  const messages: PortableMessage[] = row.messages.map((m) => {
    const attachments = parseJsonColumn(m.attachments)
    attachmentCount += countAttachments(attachments)
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      reasoning: m.reasoning,
      model: m.model,
      groupId: m.groupId,
      metadata: parseJsonColumn(m.metadata),
      attachments,
      promptTokens: m.promptTokens,
      completionTokens: m.completionTokens,
      archived: m.archived,
      archivedRoot: m.archivedRoot,
      createdAt: m.createdAt.toISOString(),
    }
  })

  return {
    id: row.id,
    title: row.title,
    model: row.model,
    mode: row.mode,
    compareModels: row.compareModels,
    styleOffset: row.styleOffset,
    stylePreset: row.stylePreset,
    replyLength: row.replyLength,
    maskId: row.maskId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messageCount: messages.filter((m) => !m.archived).length,
    attachmentCount,
    messages,
    summaries: row.summaries.map((s) => ({
      id: s.id,
      rangeStart: s.rangeStart,
      rangeEnd: s.rangeEnd,
      content: s.content,
      modelId: s.modelId,
      coveredMessages: s.coveredMessages,
      createdAt: s.createdAt.toISOString(),
    })),
    compareVotes: row.compareVotes.map((v) => ({
      id: v.id,
      groupId: v.groupId,
      votedModel: v.votedModel,
      createdAt: v.createdAt.toISOString(),
    })),
  }
}

/** 组装完整 bundle */
export function buildBundle(
  rows: ConversationExportRows[],
  appVersion?: string
): ConversationBundle {
  const bundle: ConversationBundle = {
    kind: BUNDLE_KIND,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    conversations: rows.map(toPortableConversation),
  }
  if (appVersion) bundle.appVersion = appVersion
  return bundle
}

/** 导入结果回报:每条会话的去向都点名,不给用户"不知道导没进去"的模糊态 */
export type ImportedOutcome =
  | 'created'
  /** 预演态:库里没有,确认后会新建 */
  | 'pending'
  | 'duplicate'
  | 'invalid'
  | 'foreign'

export interface ImportReport {
  outcome: ImportedOutcome
  /** 会话标题,便于前端列清单 */
  title: string
  id?: string
  reason?: string
  messages?: number
  /** 被摘掉的附件引用数 */
  strippedAttachments?: number
  /** 面具在目标实例不存在,已降级为无面具 */
  maskDropped?: boolean
}

/** 时间字符串 → Date;非 ISO / 越界一律判坏包(而不是静默变成 Invalid Date 入库) */
function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** 单条消息的字段白名单清洗;返回 null 表示这条行坏到不能入库 */
function sanitizeMessage(raw: unknown): PortableMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  const id = typeof m.id === 'string' ? m.id : ''
  const content = typeof m.content === 'string' ? m.content : null
  const role = typeof m.role === 'string' ? m.role : ''
  const createdAt = toDate(m.createdAt)
  if (!id || !createdAt) return null
  if (!['user', 'assistant', 'system'].includes(role)) return null
  if (content === null || content.length > MAX_MESSAGE_CONTENT_LEN) return null

  return {
    id,
    role,
    content,
    reasoning: asStringOrNull(m.reasoning),
    model: asStringOrNull(m.model),
    groupId: asStringOrNull(m.groupId),
    // metadata/attachments 原样透传(attachments 在落库前会被摘掉),
    // 只挡掉非对象垃圾,避免把字符串塞进 JSON 列
    metadata:
      m.metadata && typeof m.metadata === 'object' ? m.metadata : null,
    attachments: Array.isArray(m.attachments) ? m.attachments : null,
    promptTokens: typeof m.promptTokens === 'number' && Number.isFinite(m.promptTokens) ? m.promptTokens : null,
    completionTokens:
      typeof m.completionTokens === 'number' && Number.isFinite(m.completionTokens) ? m.completionTokens : null,
    archived: m.archived === true,
    archivedRoot: asStringOrNull(m.archivedRoot),
    createdAt: createdAt.toISOString(),
  }
}

/**
 * 会话条目的导入侧校验。
 * 与导出侧的不对称之处:导入不信任何"归属"字段(userId 一概不要),
 * 并且把 streaming 一律落地为 false —— 包里若有未完成的草稿行,
 * 在目标实例上不该顶着"正在生成"的状态转圈。
 */
export function sanitizeConversation(raw: unknown): PortableConversation | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  const id = typeof c.id === 'string' ? c.id : ''
  const createdAt = toDate(c.createdAt)
  const updatedAt = toDate(c.updatedAt) ?? createdAt
  if (!id || !createdAt || !updatedAt) return null
  if (!Array.isArray(c.messages) || c.messages.length === 0) return null
  if (c.messages.length > MAX_MESSAGES_PER_CONVERSATION) return null

  const messages: PortableMessage[] = []
  for (const item of c.messages) {
    const msg = sanitizeMessage(item)
    if (msg) messages.push(msg)
  }
  if (messages.length === 0) return null

  const title = typeof c.title === 'string' ? c.title.trim().slice(0, MAX_TITLE_LEN) : ''
  const summariesRaw = Array.isArray(c.summaries) ? c.summaries : []
  const votesRaw = Array.isArray(c.compareVotes) ? c.compareVotes : []

  return {
    id,
    title: title || '导入的对话',
    model: typeof c.model === 'string' ? c.model : 'gpt-4o',
    mode: c.mode === 'compare' ? 'compare' : 'single',
    compareModels: asStringOrNull(c.compareModels),
    styleOffset:
      typeof c.styleOffset === 'number' && Number.isFinite(c.styleOffset)
        ? Math.min(100, Math.max(0, Math.round(c.styleOffset)))
        : 50,
    stylePreset: asStringOrNull(c.stylePreset),
    replyLength: asStringOrNull(c.replyLength),
    maskId: asStringOrNull(c.maskId),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    messageCount: messages.filter((m) => !m.archived).length,
    attachmentCount: messages.reduce(
      (n, m) => n + countAttachments(m.attachments),
      0
    ),
    messages,
    summaries: summariesRaw
      .map((item): PortableSummary | null => {
        if (!item || typeof item !== 'object') return null
        const s = item as Record<string, unknown>
        const createdAt2 = toDate(s.createdAt)
        if (
          typeof s.id !== 'string' ||
          typeof s.rangeEnd !== 'string' ||
          typeof s.content !== 'string' ||
          !createdAt2
        )
          return null
        return {
          id: s.id,
          rangeStart: asStringOrNull(s.rangeStart),
          rangeEnd: s.rangeEnd,
          content: s.content,
          modelId: asStringOrNull(s.modelId),
          coveredMessages:
            typeof s.coveredMessages === 'number' && Number.isFinite(s.coveredMessages)
              ? s.coveredMessages
              : 0,
          createdAt: createdAt2.toISOString(),
        }
      })
      .filter((s): s is PortableSummary => s !== null),
    compareVotes: votesRaw
      .map((item): PortableVote | null => {
        if (!item || typeof item !== 'object') return null
        const v = item as Record<string, unknown>
        const createdAt2 = toDate(v.createdAt)
        if (
          typeof v.id !== 'string' ||
          typeof v.groupId !== 'string' ||
          typeof v.votedModel !== 'string' ||
          !createdAt2
        )
          return null
        return {
          id: v.id,
          groupId: v.groupId,
          votedModel: v.votedModel,
          createdAt: createdAt2.toISOString(),
        }
      })
      .filter((v): v is PortableVote => v !== null),
  }
}

/**
 * 解析用户递交的包:容忍三种形态 ——
 * 完整 bundle、裸会话数组、单个裸会话对象(用户手抖选了片段也能导)。
 * 返回错误信息一律人话,前端直接当 toast 文案。
 */
export function parseBundleInput(raw: unknown): {
  conversations: PortableConversation[]
  bundleVersion?: number
  errors: string[]
} {
  const errors: string[] = []

  const collectFromArray = (list: unknown[]) => {
    const out: PortableConversation[] = []
    list.forEach((item, idx) => {
      const c = sanitizeConversation(item)
      if (c) out.push(c)
      else errors.push(`第 ${idx + 1} 条会话结构不完整,已跳过`)
    })
    return out
  }

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>

    if (obj.kind === BUNDLE_KIND) {
      const version = typeof obj.version === 'number' ? obj.version : 0
      if (version > BUNDLE_VERSION) {
        return {
          conversations: [],
          errors: [`这份记录由更新版本导出(version ${version}),当前实例只认到 v${BUNDLE_VERSION},请先更新站点`],
        }
      }
      if (!Array.isArray(obj.conversations)) {
        return { conversations: [], errors: ['包里没有任何会话'] }
      }
      return {
        conversations: collectFromArray(obj.conversations),
        bundleVersion: version,
        errors,
      }
    }

    // 单个裸会话(手挑一段导出的时候会出现)
    if (Array.isArray(obj.messages)) {
      return { conversations: collectFromArray([obj]), bundleVersion: BUNDLE_VERSION, errors }
    }
  }

  if (Array.isArray(raw)) {
    return { conversations: collectFromArray(raw), bundleVersion: BUNDLE_VERSION, errors }
  }

  return { conversations: [], errors: ['这不是一个会话记录包:缺少 conversations 或 messages 字段'] }
}

/**
 * 把一条会话灌进目标库(同 id 幂等)。
 * 归属一律归当前登录用户;附件摘掉并在 metadata 留「未迁移」凭据。
 */
export async function importConversation(
  c: PortableConversation,
  userId: string
): Promise<ImportReport> {
  const base = { title: c.title, id: c.id }

  // 幂等判定:cuid 全局唯一,同 id 命中就不要再写第二份
  const existing = await prisma.conversation.findUnique({
    where: { id: c.id },
    select: { userId: true },
  })
  if (existing) {
    if (existing.userId !== userId) {
      return { ...base, outcome: 'foreign', reason: '该记录 id 已属于另一个账号,已拒绝写入' }
    }
    return { ...base, outcome: 'duplicate', reason: '线上已有同一条会话,跳过' }
  }

  // 自定义面具是 'user:<cuid>',那张面具未必跟着搬过来;解析不出就降级无面具,
  // 否则会话顶着一个不存在的面具,用户点进去只会得到"面具去哪了"的困惑
  let maskDropped = false
  let maskId = c.maskId
  if (maskId && maskId.startsWith('user:')) {
    const maskRowId = maskId.slice('user:'.length)
    const owned = maskRowId
      ? await prisma.mask.findFirst({ where: { id: maskRowId, userId }, select: { id: true } })
      : null
    if (!owned) {
      maskId = null
      maskDropped = true
    }
  }

  let strippedAttachments = 0
  const messageRows = c.messages.map((m) => {
    const atts = Array.isArray(m.attachments) ? m.attachments : []
    const names = atts
      .filter((a) => a && typeof a === 'object')
      .map((a) => {
        const item = a as { name?: unknown; url?: unknown }
        if (typeof item.name === 'string' && item.name) return item.name
        if (typeof item.url === 'string') return item.url.split('/').pop() ?? '附件'
        return '附件'
      })
    strippedAttachments += names.length

    const metadata =
      m.metadata && typeof m.metadata === 'object' && !Array.isArray(m.metadata)
        ? ({ ...(m.metadata as Record<string, unknown>) } as Record<string, unknown>)
        : {}
    if (names.length > 0) {
      metadata.importSkippedAttachments = { version: 1, count: names.length, names }
    }

    return {
      id: m.id,
      conversationId: c.id,
      role: m.role,
      content: m.content,
      reasoning: m.reasoning,
      // 附件文件不在包里(第一期),留空比留死链干净
      attachments: null,
      metadata: Object.keys(metadata).length ? JSON.stringify(metadata) : null,
      model: m.model,
      groupId: m.groupId,
      promptTokens: m.promptTokens,
      completionTokens: m.completionTokens,
      // 导包不该带回"正在生成"的假象
      streaming: false,
      archived: m.archived,
      archivedRoot: m.archivedRoot,
      createdAt: new Date(m.createdAt),
    }
  })

  // skipDuplicates 是静默的:若某个消息 id 撞上了别的会话的行(只可能是跨账号同库),
  // 那一条会被悄悄丢掉而事务照样成功 —— 所以把写入条数取回来比对,
  // 少写了就在回报里点名,不让用户面对"会话进来但缺了几条"的哑谜。
  const { messagesWritten } = await prisma.$transaction(async (tx) => {
    await tx.conversation.create({
      data: {
        id: c.id,
        userId,
        title: c.title,
        model: c.model,
        mode: c.mode,
        compareModels: c.compareModels,
        styleOffset: c.styleOffset,
        stylePreset: c.stylePreset,
        replyLength: c.replyLength,
        maskId,
        // 导入即转正:临时会话的隔离语义跟着 session 走,不跟着包走
        isEphemeral: false,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
      },
    })
    const msgRes = await tx.message.createMany({ data: messageRows, skipDuplicates: true })

    if (c.summaries.length) {
      await tx.conversationSummary.createMany({
        data: c.summaries.map((s) => ({
          id: s.id,
          conversationId: c.id,
          rangeStart: s.rangeStart,
          rangeEnd: s.rangeEnd,
          content: s.content,
          modelId: s.modelId,
          coveredMessages: s.coveredMessages,
          createdAt: new Date(s.createdAt),
        })),
        skipDuplicates: true,
      })
    }
    if (c.compareVotes.length) {
      await tx.compareVote.createMany({
        data: c.compareVotes.map((v) => ({
          id: v.id,
          userId,
          conversationId: c.id,
          groupId: v.groupId,
          votedModel: v.votedModel,
          createdAt: new Date(v.createdAt),
          updatedAt: new Date(v.createdAt),
        })),
        skipDuplicates: true,
      })
    }
    return { messagesWritten: msgRes.count }
  })

  const shortBy = messageRows.length - messagesWritten
  return {
    ...base,
    outcome: 'created',
    messages: messagesWritten,
    strippedAttachments,
    maskDropped,
    reason:
      shortBy > 0
        ? `有 ${shortBy} 条消息因 id 已被占用未能写入`
        : maskDropped
          ? '原自定义面具在本实例不存在，已改为无面具'
          : undefined,
  }
}
