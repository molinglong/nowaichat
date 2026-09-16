/**
 * 图表数据解析工具
 * 从 AI 消息中提取图表相关的 JSON 数据
 */

export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'scatter'

export interface ChartData {
  type: ChartType
  data: Record<string, unknown>[]
  title?: string
  xKey?: string
  yKey?: string
  nameKey?: string
  valueKey?: string
  colors?: string[]
}

export interface ParsedChartMetadata {
  kind: 'chart'
  version: 1
  chart: ChartData
}

/**
 * 解析消息中的图表元数据
 * 支持从 metadata 或 JSON 代码块中提取
 */
export function parseChartMetadata(
  metadata: Record<string, unknown> | null
): ParsedChartMetadata | null {
  if (!metadata || typeof metadata !== 'object') return null

  // 检查 metadata.kind === 'chart'
  if (metadata.kind === 'chart' && metadata.chart) {
    const chart = metadata.chart as Record<string, unknown>
    if (
      chart.type &&
      ['bar', 'line', 'pie', 'area', 'scatter'].includes(chart.type as string) &&
      Array.isArray(chart.data)
    ) {
      return {
        kind: 'chart',
        version: 1,
        chart: {
          type: chart.type as ChartType,
          data: chart.data as Record<string, unknown>[],
          title: chart.title as string | undefined,
          xKey: chart.xKey as string | undefined,
          yKey: chart.yKey as string | undefined,
          nameKey: chart.nameKey as string | undefined,
          valueKey: chart.valueKey as string | undefined,
          colors: chart.colors as string[] | undefined,
        },
      }
    }
  }

  return null
}

/**
 * 从文本内容中提取 JSON 图表数据
 * 尝试匹配 ```json 图表数据 ``` 格式
 */
export function extractChartFromText(content: string): ParsedChartMetadata | null {
  // 匹配 ```json ... ``` 代码块
  const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)\s*```/i)

  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1])

      // 检查是否是图表格式
      if (
        parsed.type &&
        ['bar', 'line', 'pie', 'area', 'scatter'].includes(parsed.type) &&
        Array.isArray(parsed.data)
      ) {
        return parseChartMetadata({ kind: 'chart', chart: parsed })
      }
    } catch {
      // JSON 解析失败，忽略
    }
  }

  return null
}

/**
 * 检测消息是否应该显示为图表
 */
export function shouldRenderChart(
  metadata: Record<string, unknown> | null,
  content: string
): boolean {
  return parseChartMetadata(metadata) !== null || extractChartFromText(content) !== null
}
