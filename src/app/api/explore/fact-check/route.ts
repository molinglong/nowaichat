/**
 * 事实核查 API
 *
 * 设计要点:
 * 1. 模型选择: 优先用户已配置的 key (按优先级兜底), 而非写死 gpt-4o
 * 2. 搜索 key: 从 searchApiKey 表读取 (与模型 key 独立)
 * 3. 区分"事实声明"和"价值/规范主张": 价值主张本身就不该 verdict = false,
 *    而应 verdict = unverifiable 且明确告知用户
 * 4. AI 判断失败时保留原文, 不要直接给 unverifiable
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import {
  getProviderForModel,
  createProviderInstance,
} from '@/lib/ai/registry'
import { executeQianfanSearch } from '@/lib/ai/search-engines/qianfan'
import { executeTavilySearch } from '@/lib/ai/search-engines/tavily'
import { generateText } from 'ai'

interface FactCheckResult {
  status: 'verified' | 'disputed' | 'unverifiable' | 'false'
  claims: {
    text: string
    type: 'fact' | 'value'
    status: 'verified' | 'disputed' | 'unverifiable' | 'false'
    verification?: string
    source?: string
  }[]
  suggestions?: string[]
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { content, topic } = await request.json()

    if (!content?.trim()) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    const userId = session.user.id

    // === 1. 选择可用的内置模型 (按用户已配置 key 的优先级) ===
    const candidateModels = ['gpt-4o', 'claude-3-5-sonnet', 'deepseek-chat', 'gemini-1.5-pro']
    let chosenModelId: string | null = null
    let apiKey: string | null = null

    for (const id of candidateModels) {
      const provider = getProviderForModel(id)
      if (!provider) continue
      const rec = await prisma.apiKey.findUnique({
        where: { userId_provider: { userId, provider: provider.id } },
      })
      if (rec?.encryptedKey) {
        chosenModelId = id
        apiKey = decrypt(rec.encryptedKey)
        break
      }
    }

    // === 2. 获取搜索结果 (使用 searchApiKey 表, 而非 apiKey 表) ===
    let searchResults = ''
    const searchErrors: string[] = []

    try {
      const [qianfanKeyRecord, tavilyKeyRecord] = await Promise.all([
        prisma.searchApiKey.findFirst({ where: { userId, engine: 'qianfan' } }),
        prisma.searchApiKey.findFirst({ where: { userId, engine: 'tavily' } }),
      ])

      const results: string[] = []
      const searchPromises: Promise<void>[] = []

      if (qianfanKeyRecord?.encryptedKey) {
        const sk = decrypt(qianfanKeyRecord.encryptedKey)
        searchPromises.push(
          executeQianfanSearch(content, sk, 3)
            .then(res => {
              if (res.length > 0) {
                results.push('【百度搜索】')
                res.forEach((item, i) => {
                  results.push(`${i + 1}. ${item.title}: ${item.snippet}`)
                  if (item.url) results.push(`   ${item.url}`)
                })
              }
            })
            .catch((err: Error) => searchErrors.push(`百度: ${err.message}`))
        )
      }

      if (tavilyKeyRecord?.encryptedKey) {
        const sk = decrypt(tavilyKeyRecord.encryptedKey)
        searchPromises.push(
          executeTavilySearch(content, sk, 3)
            .then(res => {
              if (res.length > 0) {
                results.push('【Tavily搜索】')
                res.forEach((item, i) => {
                  results.push(`${i + 1}. ${item.title}: ${item.snippet}`)
                  if (item.url) results.push(`   ${item.url}`)
                })
              }
            })
            .catch((err: Error) => searchErrors.push(`Tavily: ${err.message}`))
        )
      }

      await Promise.all(searchPromises)
      searchResults = results.length > 0 ? results.join('\n') : ''
    } catch {
      // 搜索失败不影响核查主流程
    }

    // === 3. 无可用模型时的兜底 ===
    if (!chosenModelId || !apiKey) {
      return NextResponse.json({
        result: {
          status: 'unverifiable',
          claims: [
            {
              text: content,
              type: 'fact',
              status: 'unverifiable',
              verification: searchResults
                ? '已获取搜索证据但未配置可用的 AI 模型 Key，无法自动判定；请人工核对下列搜索结果'
                : '未配置任何可用的 AI 服务商 Key。请先在设置中添加（OpenAI / Claude / DeepSeek / Gemini 任一即可）',
            },
          ],
          suggestions: searchResults
            ? ['已为你抓取相关搜索证据，可点开上方链接人工核对', '在设置页配置 AI 服务商 Key 以启用自动核查']
            : ['在设置页配置 AI 服务商 Key', '或配置百度千帆 / Tavily 搜索 Key 以丰富证据来源'],
        } satisfies FactCheckResult,
      })
    }

    // === 4. 调用 AI 进行核查 ===
    const systemPrompt = `你是一位严格的事实核查员。你的工作区分两种完全不同的声明:

【事实声明 (fact)】—— 可被证据证伪或证实, 例如:
  - "CRISPR 在 2023 年已用于镰刀型贫血治疗"
  - "深圳 2024 年房价同比下跌 6.7%"

【价值/规范主张 (value)】—— 涉及"应不应该""好不好"等无法客观判定的主张, 例如:
  - "AI 应获得法律人格"
  - "CRISPR 不应允许用于增强性状"

**关键规则**:
- value 类型声明: verdict 必须是 unverifiable, 并在 verification 中明确告知用户"这是价值观问题,不靠事实核查定对错"
- fact 类型声明: 根据搜索证据给出 verified / disputed / false / unverifiable
- 不要因为"找不到来源"就一律给 unverifiable; 常识级别的明显事实也可以 verified
- 不要因为内容"敏感"或"争议大"就一律给 unverifiable; 真有充分证据就给 verified
- JSON 解析要严格按格式, 不要在 JSON 前后添加任何 markdown 标记或解释文本

请严格按 JSON 格式返回:
{
  "status": "verified|disputed|unverifiable|false",
  "claims": [
    {
      "text": "原文中的关键声明",
      "type": "fact|value",
      "status": "verified|disputed|unverifiable|false",
      "verification": "一句话说明判定理由",
      "source": "来源 URL 或机构名 (可选)"
    }
  ],
  "suggestions": ["给用户的后续行动建议"]
}`

    const userPrompt = `待核查文本：
${content}

${topic ? `辩论主题：${topic}\n` : ''}${searchResults ? `搜索证据：\n${searchResults}` : '【无搜索证据, 请基于你的知识判定】'}`

    const aiProvider = createProviderInstance(chosenModelId, apiKey)
    const result = await generateText({
      model: aiProvider(chosenModelId),
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    // === 5. 解析 AI 输出, 失败时保留原文而非直接 unverifiable ===
    let factCheckResult: FactCheckResult

    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        // 规范化: 补全缺失字段
        factCheckResult = {
          status: parsed.status || 'unverifiable',
          claims: (parsed.claims || []).map((c: any) => ({
            text: c.text || content,
            type: c.type === 'value' ? 'value' : 'fact',
            status: c.status || 'unverifiable',
            verification: c.verification,
            source: c.source,
          })),
          suggestions: parsed.suggestions || [],
        }
      } else {
        // JSON 解析失败: 保留 AI 的文字判定, 而不是直接给 unverifiable
        factCheckResult = {
          status: 'unverifiable',
          claims: [
            {
              text: content,
              type: 'fact',
              status: 'unverifiable',
              verification: `AI 未能按 JSON 格式输出, 以下是原始反馈:\n${result.text.slice(0, 800)}`,
            },
          ],
          suggestions: ['AI 输出格式异常, 请人工核查或重试'],
        }
      }
    } catch (err) {
      factCheckResult = {
        status: 'unverifiable',
        claims: [
          {
            text: content,
            type: 'fact',
            status: 'unverifiable',
            verification: `AI 输出 JSON 解析失败: ${err instanceof Error ? err.message : '未知错误'}`,
          },
        ],
        suggestions: ['可点击"重新核查"再试一次'],
      }
    }

    return NextResponse.json({ result: factCheckResult })
  } catch (error) {
    console.error('[explore/fact-check] Error:', error)
    return NextResponse.json(
      { error: 'Fact check failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}