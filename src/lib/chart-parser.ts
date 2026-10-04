/**
 * 图表数据解析工具
 * 校验 AI 输出的图表 JSON(```chart 围栏块)并归一化为前端 ChartCard 可渲染的结构
 */

export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'scatter'

/** 多序列声明:与 ChartCard 的 ChartSeries 对齐 */
export interface ChartSeries {
  name: string
  yKey: string
}

export interface ChartData {
  type: ChartType
  data: Record<string, unknown>[]
  title?: string
  xKey?: string
  yKey?: string
  nameKey?: string
  valueKey?: string
  colors?: string[]
  series?: ChartSeries[]
}

export interface ParsedChartMetadata {
  kind: 'chart'
  version: 1
  chart: ChartData
}

/**
 * 键名推断(渲染端归一化):模型输出的数值键五花八门——单序列写 {"name":"2019年","销量":120.6}
 * 而不给 yKey,多序列写 {"name":"1990年","中国":11.35,"印度":8.73} 而漏 series 数组,
 * ChartCard 默认找 value 键找不到就整张空白图。赌提示词服从性不如从首行数据归一化可靠:
 * - x 键:首行没有 name/xKey 时取首个键
 * - 单序列:恰好一个非 x 键 → 补 yKey
 * - 多序列:多个非 x 键 → 逐键生成 series
 * - 饼图:补 valueKey
 */
function inferChartKeys<T extends ChartData>(chart: T): T {
  const first = chart.data[0]
  if (!first || typeof first !== 'object' || Array.isArray(first)) return chart

  const rowKeys = Object.keys(first as Record<string, unknown>)
  const xKey = chart.xKey || 'name'
  let xKeyResolved = chart.xKey
  if (!rowKeys.includes(xKey)) {
    xKeyResolved = rowKeys[0]
  }
  const rest = rowKeys.filter((k) => k !== (xKeyResolved || 'name'))

  let series = chart.series && chart.series.length > 0 ? chart.series : undefined
  let yKey = chart.yKey
  let valueKey = chart.valueKey

  if (!series) {
    if (rest.includes(yKey || 'value')) {
      // 行里就是 name/value(yKey 已兼容),保持现状
    } else if (rest.length === 1) {
      yKey = rest[0]
    } else if (rest.length > 1) {
      series = rest.map((k) => ({ name: k, yKey: k }))
    }
  }

  if (!rowKeys.includes(valueKey || 'value') && rest.length > 0) {
    valueKey = rest[0]
  }

  return {
    ...chart,
    xKey: xKeyResolved,
    yKey,
    valueKey,
    series,
  }
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
        chart: inferChartKeys({
          type: chart.type as ChartType,
          data: chart.data as Record<string, unknown>[],
          title: chart.title as string | undefined,
          xKey: chart.xKey as string | undefined,
          yKey: chart.yKey as string | undefined,
          nameKey: chart.nameKey as string | undefined,
          valueKey: chart.valueKey as string | undefined,
          colors: chart.colors as string[] | undefined,
          series: Array.isArray(chart.series)
            ? (chart.series as unknown[])
                .filter(
                  (s): s is { name: string; yKey: string } =>
                    !!s &&
                    typeof s === 'object' &&
                    typeof (s as { name?: unknown }).name === 'string' &&
                    typeof (s as { yKey?: unknown }).yKey === 'string'
                )
                .map((s) => ({ name: s.name, yKey: s.yKey }))
            : undefined,
        }),
      }
    }
  }

  return null
}
