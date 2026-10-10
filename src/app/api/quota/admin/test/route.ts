import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { guardAdmin } from '@/lib/admin'
import { getPublicPoolKey } from '@/lib/quota'
import { createProviderInstanceForEffectiveModel } from '@/lib/ai/registry'
import { classifyUpstreamError } from '@/lib/error-catalog'
import type { ModelDefinition } from '@/lib/ai/types'

/**
 * 公共池门面模型连通性自检（管理员专属）。
 * POST { id }  用该行的服务端 Key 真打一次上游，回「可用 / 失败+中文归类」。
 *
 * 存在的意义：Key 只存服务器且界面只显掩码，填错、被吊销、上游模型改名在服务端
 * 完全静默，只能等用户对话失败才发现。这里把同一链路提前暴露出来。
 * 口径与 chat route 对齐：发上游用真实 upstreamId 而非门面 id。
 * 检测不经 chat route 的结算，因此不落公共池额度账；但上游侧仍会产生几条
 * token 的真实消耗，故不做自动轮询，仅由管理员手动触发。
 * 已停用的行同样可检（启用前先确认能不能通）。
 */
const TEST_PROMPT = 'Reply with only the word: ok'
const MAX_OUTPUT_TOKENS = 5
const TIMEOUT_MS = 20000
const REPLY_MAX = 40

export async function POST(req: NextRequest) {
  const guarded = await guardAdmin()
  if (guarded instanceof NextResponse) return guarded

  const body = await req.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  const row = await prisma.publicPoolModel.findUnique({ where: { id } }).catch(() => null)
  if (!row) return NextResponse.json({ error: '模型不存在' }, { status: 404 })

  const startedAt = Date.now()
  const apiKey = await getPublicPoolKey(row.provider)
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      code: 'config_missing',
      error: `公共池未配置 ${row.provider} 的服务端 Key`,
      ms: Date.now() - startedAt,
    })
  }

  // 门面行的能力字段对连通性检测无意义，只为满足 ModelDefinition 形状
  const modelDef: ModelDefinition = {
    id: row.id,
    name: row.name,
    provider: row.provider,
    contextWindow: 0,
    supportsVision: false,
    supportsFiles: false,
    supportsReasoning: false,
    publicPool: true,
    upstreamId: row.upstreamId,
  }

  try {
    const { generateText } = await import('ai')
    const provider = createProviderInstanceForEffectiveModel(modelDef, apiKey)
    const result = await generateText({
      model: provider(row.upstreamId),
      messages: [{ role: 'user', content: TEST_PROMPT }],
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    })
    // 空正文不算故障：能拿到 200 说明 Key 与模型名都通（推理模型在几条 token 上限内常空返回），
    // 交给界面标「空回复」而不是红叉
    const reply = result.text.trim().slice(0, REPLY_MAX)
    return NextResponse.json({ ok: true, ms: Date.now() - startedAt, reply })
  } catch (err) {
    const info = classifyUpstreamError(err)
    console.error(`[quota/admin/test] ${row.id} (${row.provider}/${row.upstreamId}) failed:`, err)
    return NextResponse.json({
      ok: false,
      code: info.code,
      error: `${info.title}：${info.detail}`,
      raw: info.raw.slice(0, 200),
      ms: Date.now() - startedAt,
    })
  }
}
