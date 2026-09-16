/**
 * 联网搜索 API - 百度千帆 + Tavily 双引擎并行
 * 返回结构化结果供前端卡片渲染, 同时附上原始文本作为 fallback
 */
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { executeQianfanSearch } from '@/lib/ai/search-engines/qianfan'
import { executeTavilySearch } from '@/lib/ai/search-engines/tavily'

interface SearchItem {
  title: string
  url: string
  snippet: string
  source?: string
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { query } = await request.json()
    if (!query?.trim()) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    const userId = session.user.id
    const groups: { engine: string; label: string; items: SearchItem[] }[] = []
    const errors: string[] = []

    // 获取两个引擎的 API Key（使用 searchApiKey 表,与模型 key 独立）
    const [qianfanKeyRecord, tavilyKeyRecord] = await Promise.all([
      prisma.searchApiKey.findFirst({ where: { userId, engine: 'qianfan' } }),
      prisma.searchApiKey.findFirst({ where: { userId, engine: 'tavily' } }),
    ])

    const searchPromises: Promise<void>[] = []

    if (qianfanKeyRecord?.encryptedKey) {
      const apiKey = decrypt(qianfanKeyRecord.encryptedKey)
      searchPromises.push(
        executeQianfanSearch(query, apiKey, 5)
          .then(res => {
            if (res.length > 0) {
              groups.push({
                engine: 'baidu',
                label: '百度',
                items: res.map(item => ({
                  title: item.title,
                  url: item.url,
                  snippet: item.snippet,
                  source: extractDomain(item.url),
                })),
              })
            }
          })
          .catch(err => {
            errors.push(`百度: ${err instanceof Error ? err.message : '未知错误'}`)
          })
      )
    } else {
      errors.push('百度: 未配置 API Key')
    }

    if (tavilyKeyRecord?.encryptedKey) {
      const apiKey = decrypt(tavilyKeyRecord.encryptedKey)
      searchPromises.push(
        executeTavilySearch(query, apiKey, 5)
          .then(res => {
            if (res.length > 0) {
              groups.push({
                engine: 'tavily',
                label: 'Tavily',
                items: res.map(item => ({
                  title: item.title,
                  url: item.url,
                  snippet: item.snippet,
                  source: extractDomain(item.url),
                })),
              })
            }
          })
          .catch(err => {
            errors.push(`Tavily: ${err instanceof Error ? err.message : '未知错误'}`)
          })
      )
    } else {
      errors.push('Tavily: 未配置 API Key')
    }

    await Promise.all(searchPromises)

    const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0)

    if (totalItems === 0) {
      return NextResponse.json({
        structured: { query, groups: [], errors, totalCount: 0 },
        results: `未找到搜索结果。${errors.length > 0 ? '\n\n错误信息:\n' + errors.join('\n') : ''}`,
      })
    }

    return NextResponse.json({
      structured: { query, groups, errors, totalCount: totalItems },
      results: renderFallbackText(query, groups, errors),
    })
  } catch (error) {
    console.error('[explore/search] Error:', error)
    return NextResponse.json(
      { error: 'Search failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

function extractDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

function renderFallbackText(
  query: string,
  groups: { engine: string; label: string; items: SearchItem[] }[],
  errors: string[],
): string {
  const lines: string[] = [`搜索：${query}`]
  for (const g of groups) {
    lines.push(`\n【${g.label}搜索结果】`)
    g.items.forEach((item, i) => {
      lines.push(`[${i + 1}] ${item.title}`)
      lines.push(`   链接: ${item.url}`)
      lines.push(`   摘要: ${item.snippet}`)
    })
  }
  if (errors.length > 0) {
    lines.push('\n【部分搜索失败】')
    errors.forEach(err => lines.push(`· ${err}`))
  }
  return lines.join('\n')
}