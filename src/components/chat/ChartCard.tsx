'use client'

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { useId, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/* 黑白灰编辑系调色板(2026-10-02 用户选定,色板见 /color-preview.html 方案 D):
   浅色=墨黑主色 + 灰阶梯;深色=月白主色 + 灰阶反转。"贵"来自渐变代替平涂 + 收细的线条网格。
   灰阶序列超过 4 个开始难分;需要点睛时让模型经 chart.colors 传入强调色(如 #DC2626)。
   网格/坐标/图例等中性色不走这里 —— 由 globals.css 的 .chart-card 块用 CSS 变量适配全部主题。 */
const INK_LADDER_LIGHT = ['#18181B', '#71717A', '#A1A1AA', '#D4D4D8', '#3F3F46']
const INK_LADDER_DARK = ['#F4F4F5', '#A1A1AA', '#71717A', '#52525B', '#3F3F46']

/** 感知 html.dark(theme.ts 的 applyAppearance / 格子夜晚态都写它)。
    MutationObserver 而非订阅 store:主题写入方有三处,类名变化是唯一稳定信号 */
function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    const root = document.documentElement
    const update = () => setIsDark(root.classList.contains('dark'))
    update()
    const mo = new MutationObserver(update)
    mo.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])
  return isDark
}

/** 多序列声明:每条折线/柱/面积一条,data 行里以 yKey 为键取值 */
interface ChartSeries {
  name: string
  yKey: string
}

interface ChartData {
  type: 'bar' | 'line' | 'pie' | 'area' | 'scatter'
  data: Record<string, unknown>[]
  title?: string
  xKey?: string
  yKey?: string
  nameKey?: string
  valueKey?: string
  colors?: string[]
  series?: ChartSeries[]
}

interface ChartCardProps {
  chart: ChartData
  className?: string
}

const AXIS_TICK = { fontSize: 11, fill: '#a1a1aa' }
const GRID_STROKE = '#f4f4f5'

function hexToRgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/**
 * 图表卡片组件(黑白灰编辑系)
 * 支持 bar、line、pie、area 等常用图表类型
 */
export function ChartCard({ chart, className }: ChartCardProps) {
  const isDark = useIsDarkTheme()
  const colors = chart.colors || (isDark ? INK_LADDER_DARK : INK_LADDER_LIGHT)
  // 渐变 id 全局唯一:同页多张卡时 <linearGradient id> 共享文档命名空间,撞 id 会串色
  const uid = useId().replace(/:/g, '')
  // 序列归一:未声明 series 时退化为单序列(图例名与取值键同为 yKey,行为与旧版一致)
  const series =
    chart.series && chart.series.length > 0
      ? chart.series
      : [{ name: chart.yKey || 'value', yKey: chart.yKey || 'value' }]

  const renderChart = () => {
    switch (chart.type) {
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chart.data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <defs>
                {series.map((s, i) => (
                  <linearGradient key={i} id={`${uid}-bar-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors[i % colors.length]} stopOpacity={0.92} />
                    <stop offset="100%" stopColor={colors[i % colors.length]} stopOpacity={0.68} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey={chart.xKey || 'name'} tick={AXIS_TICK} axisLine={{ stroke: '#e4e4e7' }} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ backgroundColor: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: '8px', color: 'rgb(var(--content-primary))' }} />
              <Legend />
              {series.map((s, i) => (
                <Bar
                  key={s.yKey}
                  dataKey={s.yKey}
                  name={s.name}
                  fill={`url(#${uid}-bar-${i})`}
                  radius={[5, 5, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )

      case 'line':
        // 单序列:墨色线 + 渐隐面积(编辑风招牌);多序列:干净细线,不加面积
        if (series.length === 1) {
          const c = colors[0]
          return (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chart.data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <defs>
                  <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={c} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey={chart.xKey || 'name'} tick={AXIS_TICK} axisLine={{ stroke: '#e4e4e7' }} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: '8px', color: 'rgb(var(--content-primary))' }} />
                <Area
                  type="monotone"
                  dataKey={series[0].yKey}
                  name={series[0].name}
                  stroke={c}
                  strokeWidth={2.5}
                  fill={`url(#${uid}-area)`}
                  dot={{ r: 4, fill: c, stroke: '#fff', strokeWidth: 1.5 }}
                  activeDot={{ r: 5.5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )
        }
        return (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chart.data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey={chart.xKey || 'name'} tick={AXIS_TICK} axisLine={{ stroke: '#e4e4e7' }} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ backgroundColor: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: '8px', color: 'rgb(var(--content-primary))' }} />
              <Legend />
              {series.map((s, i) => (
                <Line
                  key={s.yKey}
                  type="monotone"
                  dataKey={s.yKey}
                  name={s.name}
                  stroke={colors[i % colors.length]}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: colors[i % colors.length], stroke: '#fff', strokeWidth: 1.5 }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )

      case 'area':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chart.data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <defs>
                {series.map((s, i) => (
                  <linearGradient key={i} id={`${uid}-area-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors[i % colors.length]} stopOpacity={0.26} />
                    <stop offset="100%" stopColor={colors[i % colors.length]} stopOpacity={0.03} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey={chart.xKey || 'name'} tick={AXIS_TICK} axisLine={{ stroke: '#e4e4e7' }} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ backgroundColor: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: '8px', color: 'rgb(var(--content-primary))' }} />
              <Legend />
              {series.map((s, i) => (
                <Area
                  key={s.yKey}
                  type="monotone"
                  dataKey={s.yKey}
                  name={s.name}
                  stroke={colors[i % colors.length]}
                  strokeWidth={2.5}
                  fill={`url(#${uid}-area-${i})`}
                  dot={{ r: 3, fill: colors[i % colors.length], stroke: '#fff', strokeWidth: 1.5 }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )

      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={chart.data}
                dataKey={chart.valueKey || 'value'}
                nameKey={chart.nameKey || 'name'}
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
              >
                {chart.data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={colors[index % colors.length]} stroke="#fff" strokeWidth={3} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: '8px', color: 'rgb(var(--content-primary))' }} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )

      default:
        return <div className="text-sm text-content-muted">不支持的图表类型: {chart.type}</div>
    }
  }

  return (
    <div
      className={cn('chart-card', className)}
      style={{
        backgroundColor: 'rgb(var(--surface))',
        borderRadius: '12px',
        padding: '16px',
        border: '1px solid rgb(var(--line))',
      }}
    >
      {chart.title && (
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: 'rgb(var(--content-primary))' }}>
          {chart.title}
        </h4>
      )}
      {renderChart()}
    </div>
  )
}
