'use client'

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

const DEFAULT_COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#00C49F', '#FFBB28', '#FF8042']

interface ChartData {
  type: 'bar' | 'line' | 'pie' | 'area' | 'scatter'
  data: Record<string, unknown>[]
  title?: string
  xKey?: string
  yKey?: string
  nameKey?: string
  valueKey?: string
  colors?: string[]
}

interface ChartCardProps {
  chart: ChartData
  className?: string
}

/**
 * 图表卡片组件
 * 支持 bar、line、pie、area 等常用图表类型
 */
export function ChartCard({ chart, className }: ChartCardProps) {
  const colors = chart.colors || DEFAULT_COLORS

  const renderChart = () => {
    switch (chart.type) {
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chart.data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey={chart.xKey || 'name'} tick={{ fill: '#6b7280', fontSize: 12 }} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} />
              <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }} />
              <Legend />
              <Bar dataKey={chart.yKey || 'value'} fill={colors[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )

      case 'line':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chart.data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey={chart.xKey || 'name'} tick={{ fill: '#6b7280', fontSize: 12 }} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} />
              <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }} />
              <Legend />
              <Line type="monotone" dataKey={chart.yKey || 'value'} stroke={colors[0]} strokeWidth={2} dot={{ fill: colors[0], r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        )

      case 'area':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chart.data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey={chart.xKey || 'name'} tick={{ fill: '#6b7280', fontSize: 12 }} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 12 }} />
              <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }} />
              <Legend />
              <Area type="monotone" dataKey={chart.yKey || 'value'} stroke={colors[0]} fill={colors[0]} fillOpacity={0.3} />
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
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {chart.data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )

      default:
        return <div className="text-sm text-gray-500">不支持的图表类型: {chart.type}</div>
    }
  }

  return (
    <div
      className={className}
      style={{
        backgroundColor: '#fff',
        borderRadius: '12px',
        padding: '16px',
        border: '1px solid #e5e7eb',
      }}
    >
      {chart.title && (
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: '#111827' }}>
          {chart.title}
        </h4>
      )}
      {renderChart()}
    </div>
  )
}
