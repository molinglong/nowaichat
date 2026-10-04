import { createHash } from 'crypto'
import { generateText, type LanguageModel } from 'ai'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { providers } from '@/lib/ai/registry'
import { monitor } from '@/lib/monitor'
import { sanitizeErrorText, type UpstreamErrorCode } from '@/lib/error-catalog'

export interface ErrorDiagnosis {
  cause: string
  steps: string[]
}

/**
 * 「让 AI 分析原因」：把上游原始错误交给轻量模型翻译成中文原因 + 排查步骤。
 *
 * 三条防线（成本与稳定性）：
 * 1. 诊断用的 Key 一定不是出错那家：优先服务端 env 的通义免费额度，其次该用户其他服务商的 Key；
 *    某个候选自身不可用（额度耗尽/鉴权失败）时自动换下一个；
 * 2. 按错误原文哈希缓存 1 小时，重试不重复烧 token；
 * 3. 每用户 10 分钟 6 次上限，超频直接拒绝。
 */
const CACHE_TTL_MS = 60 * 60 * 1000
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX = 6

/** 诊断只读一段错误文本，用各家最便宜的档位即可 */
const CHEAP_MODEL: Record<string, string> = {
  qianwen: 'qwen3.8-flash',
  deepseek: 'deepseek-flash',
  zhipu: 'glm-5.3-flash',
  groq: 'openai/gpt-oss-20b',
  doubao: 'doubao-seed-2-1-lite-260915',
  wenxin: 'ernie-4.5-turbo-128k',
}
const PROVIDER_PREF = ['qianwen', 'deepseek', 'zhipu', 'groq', 'doubao', 'wenxin']

const cache = new Map<string, { at: number; data: ErrorDiagnosis }>()
const rateHits = new Map<string, number[]>()

function allowUser(userId: string): boolean {
  const now = Date.now()
  const recent = (rateHits.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_MAX) {
    rateHits.set(userId, recent)
    return false
  }
  recent.push(now)
  rateHits.set(userId, recent)
  return true
}

function cheapModelId(providerKey: string): string | undefined {
  const provider = providers[providerKey]
  if (!provider) return undefined
  const preferred = CHEAP_MODEL[providerKey]
  if (preferred && provider.models.some((m) => m.id === preferred)) return preferred
  return provider.models[0]?.id
}

/** 诊断候选模型：跳过出错那家服务商，避免拿同一个坏 Key 再撞一次 */
async function listDiagnosers(
  userId: string,
  excludeProvider?: string
): Promise<Array<{ model: LanguageModel; label: string }>> {
  const out: Array<{ model: LanguageModel; label: string }> = []
  const envKey = process.env.API_KEY_DASHSCOPE
  if (envKey && excludeProvider !== 'qianwen' && cheapModelId('qianwen')) {
    out.push({ model: providers.qianwen.createProvider(envKey)(CHEAP_MODEL.qianwen), label: 'qianwen-env' })
  }

  const records = await prisma.apiKey.findMany({ where: { userId } })
  const order = [
    ...PROVIDER_PREF.filter((p) => p !== excludeProvider),
    ...records.map((r) => r.provider).filter((p) => !PROVIDER_PREF.includes(p) && p !== excludeProvider),
  ]
  for (const providerKey of order) {
    if (out.some((c) => c.label === providerKey)) continue
    const record = records.find((r) => r.provider === providerKey)
    const modelId = cheapModelId(providerKey)
    if (!record || !modelId) continue
    try {
      out.push({ model: providers[providerKey].createProvider(decrypt(record.encryptedKey))(modelId), label: providerKey })
    } catch {
      // 该记录解密失败：换下一个候选
    }
  }
  return out
}

function parseDiagnosis(text: string): ErrorDiagnosis | null {
  const jsonStart = text.indexOf('{')
  const jsonEnd = text.lastIndexOf('}')
  if (jsonStart === -1 || jsonEnd <= jsonStart) return null
  try {
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as Partial<ErrorDiagnosis>
    const cause = typeof parsed.cause === 'string' ? parsed.cause.trim() : ''
    const steps = Array.isArray(parsed.steps)
      ? parsed.steps.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 5)
      : []
    if (!cause || steps.length === 0) return null
    return { cause: cause.slice(0, 200), steps }
  } catch {
    return null
  }
}

export async function diagnoseUpstreamError(input: {
  userId: string
  raw: string
  code: UpstreamErrorCode
  provider?: string
  modelId?: string
}): Promise<{ data: ErrorDiagnosis | null; reason?: 'no_key' | 'all_failed' | 'rate_limited' }> {
  const raw = sanitizeErrorText(input.raw).slice(0, 600)
  if (!raw) return { data: null, reason: 'no_key' }
  if (!allowUser(input.userId)) return { data: null, reason: 'rate_limited' }

  const key = createHash('sha1').update(`${input.code}|${raw}`).digest('hex')
  const now = Date.now()
  for (const [k, v] of Array.from(cache.entries())) {
    if (now - v.at > CACHE_TTL_MS) cache.delete(k)
  }
  const cached = cache.get(key)
  if (cached && now - cached.at < CACHE_TTL_MS) return { data: cached.data }

  const candidates = await listDiagnosers(input.userId, input.provider)
  if (candidates.length === 0) return { data: null, reason: 'no_key' }

  for (const candidate of candidates) {
    try {
      const { text } = await generateText({
        model: candidate.model,
        system:
          '你是 AI 服务商报错诊断助手。用户会给你一段上游返回的原始错误文本，请用简体中文说明原因并给出排查步骤。\n' +
          '只输出一个 JSON 对象，形如 {"cause":"一句话原因","steps":["步骤1","步骤2"]}。\n' +
          'cause 不超过 40 字，直接说清是配置问题、额度问题还是服务商问题。\n' +
          'steps 给 2-4 条，每条不超过 30 字，必须是用户能立刻执行的动作（例如去设置里改什么、换哪个模型、等多久重试）。\n' +
          '不要复述原始错误文本，不要输出 JSON 以外的内容。',
        prompt:
          `错误分类：${input.code}\n` +
          `服务商：${input.provider || '未知'}\n` +
          `模型：${input.modelId || '未知'}\n` +
          `原始错误：${raw}`,
        temperature: 0.2,
      })
      const data = parseDiagnosis(text)
      monitor('chat_error_diagnose', { ok: Boolean(data), code: input.code, via: candidate.label })
      if (data) {
        cache.set(key, { at: Date.now(), data })
        return { data }
      }
    } catch (err) {
      console.warn(`[error-doctor] via ${candidate.label} failed:`, err instanceof Error ? err.message : err)
      monitor('chat_error_diagnose', { ok: false, code: input.code, via: candidate.label, stage: 'throw' })
    }
  }
  return { data: null, reason: 'all_failed' }
}
