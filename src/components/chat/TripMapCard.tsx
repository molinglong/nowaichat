'use client'

/**
 * 行程地图卡片 — 渲染 plan_trip 工具的「地图 + 时间线」交互行程卡
 *
 * 三态(view.state 驱动):
 * - 流式/校准中(input-streaming / input-available):卡片壳 + shimmer 占位
 * - 成功(output-available + ok):天 tab + 地图(当日聚焦/其余淡显)+ 时间线联动 + 全屏总览
 * - 失败(output-error 或 ok:false):红色一行 + 错误信息
 *
 * 渲染要点(与 public/preview-trip-map.html 实测逻辑同构):
 * - 坐标:服务端 execute 已做高德 POI 校准;前端再做段间真实路径规划(Walking/Transfer/Driving)
 * - 段规划结果模块级缓存(同起点/方式复用),token 防切天竞态
 * - 地图懒建:IntersectionObserver 进入视口才加载高德脚本(历史消息可能多张卡)
 * - 暗色:documentElement 挂 dark class 切 amap://styles/dark,MutationObserver 联动
 * - 注入高德的 marker/badge/InfoWindow HTML 全内联样式 + escape(不依赖 Tailwind 扫描)
 */
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CarTaxiFront,
  ChevronDown,
  Footprints,
  Loader2,
  MapPinned,
  Maximize2,
  Minimize2,
  TrainFront,
  TriangleAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  loadAmap,
  type AMapInfoWindow,
  type AMapMap,
  type AMapNamespace,
  type AMapOverlay,
} from '@/lib/amap-loader'
import {
  isTripToolOutput,
  toTripData,
  type TripData,
  type TripDay,
  type TripMoveMode,
  type TripStopData,
} from '@/lib/ai/trip-tool'
import type { ToolCallView } from './ToolCallCard'

/* ---------------- 常量与小工具 ---------------- */

const MODE_META: Record<TripMoveMode, { icon: typeof Footprints; label: string; emoji: string }> = {
  walk: { icon: Footprints, label: '步行', emoji: '🚶' },
  transit: { icon: TrainFront, label: '公交地铁', emoji: '🚇' },
  drive: { icon: CarTaxiFront, label: '打车', emoji: '🚕' },
}

/** "R G B" 空格串转 "#rrggbb"(高德 2.0 strokeColor 只认 16 进制) */
const hexOf = (rgb: string) =>
  '#' + rgb.split(' ').map(Number).map((x) => x.toString(16).padStart(2, '0')).join('')

/** 注入高德 HTML 的转义(站名等来自模型/历史数据,必须防 XSS) */
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

const yuan = (n: number) => `¥${Math.round(n).toLocaleString('zh-CN')}`

/** 高德 path 元素归一为 [lng,lat][](兼容 LngLat 对象与数组两种形态) */
function ptsOf(path: unknown): [number, number][] {
  if (!Array.isArray(path)) return []
  const out: [number, number][] = []
  for (const p of path) {
    if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
      out.push([p[0] as number, p[1] as number])
    } else if (p && typeof p === 'object') {
      const o = p as { getLng?: () => number; getLat?: () => number; lng?: unknown; lat?: unknown }
      if (typeof o.getLng === 'function' && typeof o.getLat === 'function') {
        out.push([o.getLng(), o.getLat()])
      } else if (Number.isFinite(o.lng as number) && Number.isFinite(o.lat as number)) {
        out.push([o.lng as number, o.lat as number])
      }
    }
  }
  return out
}

/** 规划失败时的直线时间估算(分钟) */
function estMinutes(mode: TripMoveMode, km: number): number {
  const speed = mode === 'walk' ? 4.8 : mode === 'transit' ? 22 : 28
  return Math.max(2, Math.round((km / speed) * 60))
}

function haversineKm(a: TripStopData, b: TripStopData): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/* ---------------- 段间路径规划(模块级缓存,跨卡片/全屏复用) ---------------- */

interface RouteSegResult {
  mode: TripMoveMode
  ok: boolean
  minutes?: number
  distanceKm?: number
  /** 真实路径(规划成功);失败为空由调用方画降级直线 */
  pts?: [number, number][]
  /** 公交线路名,如「地铁2号线」 */
  lineName?: string
}

interface TransitLeg {
  path?: unknown
  steps?: Array<{ path?: unknown }>
  lines?: Array<{ name?: string }>
}
interface TransitSegment {
  transit?: TransitLeg | null
}
interface TransitPlan {
  time?: number
  distance?: number
  segments?: TransitSegment[]
}
interface RoutePlanLike {
  time?: number
  distance?: number
  steps?: Array<{ path?: unknown }>
  routes?: RoutePlanLike[]
  plans?: TransitPlan[]
}

const segCacheKey = (a: TripStopData, b: TripStopData, mode: TripMoveMode) =>
  `${a.lng.toFixed(5)},${a.lat.toFixed(5)}|${b.lng.toFixed(5)},${b.lat.toFixed(5)}|${mode}`
const routeCache = new Map<string, RouteSegResult>()

/** 高德插件真实规划(实测 2.0 结构:路径取 sg.transit.path,线路名在 sg.transit.lines[0].name) */
function planSeg(
  AMap: AMapNamespace,
  mode: TripMoveMode,
  from: TripStopData,
  to: TripStopData,
  city: string
): Promise<RouteSegResult> {
  const key = segCacheKey(from, to, mode)
  const cached = routeCache.get(key)
  if (cached) return Promise.resolve(cached)
  return new Promise((resolve) => {
    const finish = (r: RouteSegResult) => {
      routeCache.set(key, r)
      resolve(r)
    }
    let retried = false
    // 失败自动重试一次(偶发网络抖动/限流);坐标本身无效时两次都失败,降级直线
    const attempt = () => {
      try {
        const names =
          mode === 'walk' ? ['AMap.Walking'] : mode === 'transit' ? ['AMap.Transfer'] : ['AMap.Driving']
        AMap.plugin(names, () => {
          const onFail = () => {
            if (!retried) {
              retried = true
              window.setTimeout(attempt, 600)
              return
            }
            finish({ mode, ok: false })
          }
          if (mode === 'transit') {
            const planner = new AMap.Transfer!({ city, hideMarkers: true, policy: 0 })
            planner.search([from.lng, from.lat], [to.lng, to.lat], (status, result) => {
              if (status !== 'complete') return onFail()
              const plan = (result as RoutePlanLike).plans?.[0]
              if (!plan) return onFail()
              let pts: [number, number][] = []
              let lineName = ''
              for (const sg of plan.segments ?? []) {
                const t = sg.transit
                if (!t) continue
                const segPts = ptsOf(t.path).length ? ptsOf(t.path) : (t.steps ?? []).flatMap((st) => ptsOf(st.path))
                pts = pts.concat(segPts)
                if (!lineName) {
                  const raw = (t.lines ?? [])[0]?.name ?? ''
                  lineName = raw.split('(')[0].split('（')[0].trim()
                }
              }
              finish({
                mode,
                ok: pts.length > 1,
                pts: pts.length > 1 ? pts : undefined,
                minutes: plan.time ? Math.max(1, Math.round(plan.time / 60)) : undefined,
                distanceKm: plan.distance ? plan.distance / 1000 : undefined,
                lineName: lineName || undefined,
              })
            })
            return
          }
          // walk / drive:routes[0].steps[].path
          const planner =
            mode === 'walk' ? new AMap.Walking!({ hideMarkers: true }) : new AMap.Driving!({ hideMarkers: true })
          planner.search([from.lng, from.lat], [to.lng, to.lat], (status, result) => {
            if (status !== 'complete') return onFail()
            const r0 = (result as RoutePlanLike).routes?.[0]
            if (!r0) return onFail()
            const pts = (r0.steps ?? []).flatMap((st) => ptsOf(st.path))
            finish({
              mode,
              ok: pts.length > 1,
              pts: pts.length > 1 ? pts : undefined,
              minutes: r0.time ? Math.max(1, Math.round(r0.time / 60)) : undefined,
              distanceKm: r0.distance ? r0.distance / 1000 : undefined,
            })
          })
        })
      } catch {
        finish({ mode, ok: false })
      }
    }
    attempt()
  })
}

/* ---------------- 注入高德的 HTML(内联样式,亮暗按当前主题生成) ---------------- */

const isDarkNow = () =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
const mapStyleOf = (dark: boolean) => (dark ? 'amap://styles/dark' : 'amap://styles/whitesmoke')

function pinHtml(index: number, colorRgb: string, dim: boolean): string {
  const [r, g, b] = colorRgb.split(' ').map(Number)
  return `<div style="width:24px;height:24px;border-radius:12px 12px 12px 2px;transform:rotate(-45deg);
    background:rgb(${r},${g},${b});border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);
    display:flex;align-items:center;justify-content:center;opacity:${dim ? 0.35 : 1};
    transition:opacity .3s;cursor:pointer">
    <span style="transform:rotate(45deg);color:#fff;font-size:11px;font-weight:700;line-height:1">${index}</span>
  </div>`
}

function badgeHtml(seg: RouteSegResult, colorRgb: string, from: TripStopData, to: TripStopData): string {
  const [r, g, b] = colorRgb.split(' ').map(Number)
  const km = seg.distanceKm ?? haversineKm(from, to)
  const label = seg.ok
    ? `${seg.lineName ? seg.lineName + ' · ' : ''}${seg.minutes ?? estMinutes(seg.mode, km)}分钟`
    : `约${estMinutes(seg.mode, km)}分钟 · 直线示意`
  return `<div style="background:rgba(255,255,255,.95);border:1px solid rgb(${r},${g},${b});
    color:#1f2937;font-size:10px;line-height:1;padding:3px 7px;border-radius:999px;white-space:nowrap;
    box-shadow:0 1px 4px rgba(0,0,0,.2);opacity:${seg.ok ? 1 : 0.75}">
    ${MODE_META[seg.mode].emoji} ${esc(label)}
  </div>`
}

function infoHtml(stop: TripStopData, dayNo: number, colorHex: string): string {
  const dark = isDarkNow()
  const fg = dark ? '#e5e7eb' : '#1f2937'
  const sub = dark ? '#9ca3af' : '#6b7280'
  const bg = dark ? 'rgba(31,33,38,.96)' : 'rgba(255,255,255,.97)'
  const warn = dark ? '#fbbf24' : '#b45309'
  return `<div style="position:relative;background:${bg};border:1px solid ${colorHex}55;border-radius:12px;padding:10px 12px;
    box-shadow:0 8px 24px rgba(0,0,0,.18);max-width:230px;font-family:inherit">
    <button data-win-close aria-label="关闭" style="position:absolute;top:-8px;right:-8px;width:20px;height:20px;
      border-radius:999px;border:1px solid ${colorHex}55;background:${bg};color:${sub};font-size:12px;line-height:1;
      cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.25)">×</button>
    <div style="display:flex;align-items:center;gap:6px">
      <span style="width:8px;height:8px;border-radius:4px;background:${colorHex};flex-shrink:0"></span>
      <span style="color:${fg};font-size:13px;font-weight:600">${esc(stop.name)}</span>
    </div>
    <div style="margin-top:4px;color:${sub};font-size:11px;display:flex;gap:8px;align-items:center">
      <span>Day ${dayNo} · ${esc(stop.time)}</span>
      <span style="padding:1px 6px;border-radius:999px;background:${colorHex}1a;color:${colorHex}">${esc(stop.tag)}</span>
      ${stop.budget > 0 ? `<span>${yuan(stop.budget)}</span>` : ''}
    </div>
    <div style="margin-top:5px;color:${sub};font-size:11px;line-height:1.5">${esc(stop.desc)}</div>
    ${stop.cal === false
      ? `<div style="margin-top:5px;color:${warn};font-size:10px;line-height:1.4">⚠ 该站点未匹配到地图 POI,位置为近似标注,仅供参考</div>`
      : ''}
  </div>`
}

/* ---------------- 叠加层桶(切天重建用) ---------------- */

interface OverlayRec {
  overlay: AMapOverlay
  dayIdx: number
  /** 参与淡显;marker 额外参与当天 setFitView */
  kind: 'marker' | 'polyline' | 'badge'
}
type OverlayBucket = OverlayRec[]

/** 清线段与徽章(markers 常驻,仅靠淡显控制视觉);dayIdx 缺省清全部天 */
function clearRoutes(map: AMapMap, bucket: OverlayBucket, dayIdx?: number) {
  const doomed = bucket.filter(
    (r) => r.kind !== 'marker' && (dayIdx === undefined || r.dayIdx === dayIdx)
  )
  if (doomed.length === 0) return
  map.remove(doomed.map((r) => r.overlay))
  const kept = bucket.filter((r) => !doomed.includes(r))
  bucket.length = 0
  bucket.push(...kept)
}

/* ---------------- 卡片 ---------------- */

interface TripMapCardProps {
  view: ToolCallView
}

function TripMapCardInner({ view }: TripMapCardProps) {
  const output = isTripToolOutput(view.output) ? view.output : null
  const failed =
    view.state === 'output-error' ||
    (view.state === 'output-available' && view.output != null && output === null)

  // 行程数据:优先 execute 校准后的 output.trip,兜底 input(流式/历史降级)
  const trip = useMemo<TripData | null>(() => {
    if (output && output.ok) return output.trip
    return toTripData(view.input)
  }, [output, view.input])

  const message =
    view.state === 'output-error'
      ? view.errorText || '行程规划失败'
      : output && !output.ok
        ? output.message
        : '行程数据不完整'

  /* --- 状态与引用 --- */
  const containerRef = useRef<HTMLDivElement>(null)
  const AMapRef = useRef<AMapNamespace | null>(null)
  const mapRef = useRef<AMapMap | null>(null)
  const overlaysRef = useRef<OverlayBucket>([])
  const routeTokenRef = useRef(0)
  const fsContainerRef = useRef<HTMLDivElement>(null)
  const fsMapRef = useRef<AMapMap | null>(null)
  const fsOverlaysRef = useRef<OverlayBucket>([])
  const fsRouteTokenRef = useRef(0)
  const timelineRefs = useRef<Array<HTMLDivElement | null>>([])
  const fsTimelineRefs = useRef<Array<HTMLDivElement | null>>([])
  // 每张地图当前打开的行程窗(内嵌/全屏各一;切天/开新窗前先关,避免叠放)
  const infoWinsRef = useRef<Map<AMapMap, AMapInfoWindow>>(new Map())

  const [inView, setInView] = useState(false)
  const [mapError, setMapError] = useState(false)
  const [activeDay, setActiveDay] = useState(0)
  const activeDayRef = useRef(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [flash, setFlash] = useState<{ dayIdx: number; stopIdx: number } | null>(null)
  const [routeTick, setRouteTick] = useState(0) // 段规划完成 → 时间线徽章刷新

  useEffect(() => {
    activeDayRef.current = activeDay
    // 切天关掉行程窗:站点转入淡显,旧窗悬浮会误导
    infoWinsRef.current.forEach((w) => w.close())
    infoWinsRef.current.clear()
  }, [activeDay])

  const activeDayData: TripDay | null = trip ? trip.days[activeDay] ?? null : null
  const stopsBudget = useMemo(
    () =>
      trip
        ? trip.days.reduce((acc, d) => acc + d.stops.reduce((a, s) => a + (s.budget || 0), 0), 0)
        : 0,
    [trip]
  )

  /* --- 交互回调(闭包持 ref,避免 marker 事件过期) --- */

  const flashStop = useCallback((dayIdx: number, stopIdx: number, useFs = false) => {
    setFlash({ dayIdx, stopIdx })
    // 内嵌/全屏时间线各持 refs,滚对应容器(共用数组会被全屏卸载清掉)
    const el = (useFs ? fsTimelineRefs : timelineRefs).current[stopIdx]
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    window.setTimeout(() => setFlash((f) => (f && f.dayIdx === dayIdx && f.stopIdx === stopIdx ? null : f)), 1200)
  }, [])

  const openInfo = useCallback(
    (dayIdx: number, stopIdx: number, useFs: boolean) => {
      const data = trip
      if (!data) return
      const day = data.days[dayIdx]
      const stop = day?.stops[stopIdx]
      if (!day || !stop) return
      const AMap = AMapRef.current
      const map = useFs ? fsMapRef.current : mapRef.current
      if (!AMap || !map) return
      // 同一地图只保留一个窗:isCustom 实例互不知晓,不关旧窗会叠放
      infoWinsRef.current.get(map)?.close()
      // 每次新建:注入内容含主题相关样式,复用实例无法响应主题切换;
      // isCustom 无自带关闭钮,content 传 HTMLElement 以便给关闭按钮绑事件
      const holder = document.createElement('div')
      holder.innerHTML = infoHtml(stop, day.day, hexOf(day.color))
      const win = new AMap.InfoWindow({
        isCustom: true,
        anchor: 'bottom-center',
        closeWhenClickMap: true,
        content: (holder.firstElementChild as HTMLElement) ?? holder,
      })
      holder.querySelector('[data-win-close]')?.addEventListener('click', (e) => {
        e.stopPropagation()
        win.close()
        infoWinsRef.current.delete(map)
      })
      win.open(map, [stop.lng, stop.lat])
      infoWinsRef.current.set(map, win)
    },
    [trip]
  )

  const focusStop = useCallback(
    (dayIdx: number, stopIdx: number, useFs: boolean) => {
      const day = trip?.days[dayIdx]
      const stop = day?.stops[stopIdx]
      const map = useFs ? fsMapRef.current : mapRef.current
      if (!day || !stop || !map) return
      map.setCenter([stop.lng, stop.lat])
      map.setZoom(15, true)
      openInfo(dayIdx, stopIdx, useFs)
      flashStop(dayIdx, stopIdx, useFs)
    },
    [trip, openInfo, flashStop]
  )

  /* --- 叠加层绘制 --- */

  const buildMarkers = useCallback(
    (AMap: AMapNamespace, map: AMapMap, bucket: OverlayBucket, focusDay: number) => {
      const data = trip
      if (!data) return
      data.days.forEach((day, dayIdx) => {
        day.stops.forEach((stop, si) => {
          const marker = new AMap.Marker({
            position: [stop.lng, stop.lat],
            content: pinHtml(si + 1, day.color, dayIdx !== focusDay),
            anchor: 'bottom-center',
            zIndex: dayIdx === focusDay ? 110 : 90,
          })
          marker.on?.('click', () => {
            const useFs = map === fsMapRef.current
            openInfo(dayIdx, si, useFs)
            flashStop(dayIdx, si, useFs)
          })
          map.add(marker)
          bucket.push({ overlay: marker, dayIdx, kind: 'marker' })
        })
      })
    },
    [trip, openInfo, flashStop]
  )

  const drawSeg = useCallback(
    (
      AMap: AMapNamespace,
      map: AMapMap,
      bucket: OverlayBucket,
      dayIdx: number,
      colorRgb: string,
      from: TripStopData,
      to: TripStopData,
      seg: RouteSegResult
    ) => {
      const colorHex = hexOf(colorRgb)
      const path =
        seg.ok && seg.pts && seg.pts.length > 1
          ? seg.pts
          : [
              [from.lng, from.lat] as [number, number],
              [to.lng, to.lat] as [number, number],
            ]
      const polyline = new AMap.Polyline({
        path,
        strokeColor: colorHex,
        strokeWeight: seg.ok ? 5 : 2.5,
        strokeOpacity: seg.ok ? 0.92 : 0.65,
        strokeStyle: seg.ok ? 'solid' : 'dashed',
        showDir: seg.ok,
        lineJoin: 'round',
        lineCap: 'round',
        zIndex: 60,
      })
      map.add(polyline)
      bucket.push({ overlay: polyline, dayIdx, kind: 'polyline' })
      const midIdx = Math.floor(path.length / 2)
      const badge = new AMap.Marker({
        position: path.length > 1 ? path[midIdx] : [from.lng, from.lat],
        content: badgeHtml(seg, colorRgb, from, to),
        anchor: 'center',
        zIndex: 100,
      })
      map.add(badge)
      bucket.push({ overlay: badge, dayIdx, kind: 'badge' })
      setRouteTick((t) => t + 1)
    },
    []
  )

  /** 画段间路线:单天(dayIdx)或全部天(all,全屏总览用)。缓存命中直画;未命中异步规划,token 防竞态 */
  const drawRoutesFor = useCallback(
    (
      AMap: AMapNamespace,
      map: AMapMap,
      bucket: OverlayBucket,
      dayIdx: number,
      tokenRef: { current: number },
      all = false
    ) => {
      const data = trip
      if (!data) return
      // 只清线段/徽章(markers 常驻);单天模式清该天(切天重画),全部模式清所有天(全屏重建)
      clearRoutes(map, bucket, all ? undefined : dayIdx)
      tokenRef.current += 1
      const my = tokenRef.current
      const days = all ? data.days : [data.days[dayIdx]]
      days.forEach((day) => {
        if (!day) return
        const realDayIdx = data.days.indexOf(day)
        const colorRgb = day.color
        day.stops.forEach((to, i) => {
          if (i === 0) return
          const from = day.stops[i - 1]
          const mode = day.moves[i - 1] ?? 'drive'
          const cached = routeCache.get(segCacheKey(from, to, mode))
          if (cached) {
            drawSeg(AMap, map, bucket, realDayIdx, colorRgb, from, to, cached)
            return
          }
          void planSeg(AMap, mode, from, to, data.city).then((seg) => {
            if (my !== tokenRef.current) return
            drawSeg(AMap, map, bucket, realDayIdx, colorRgb, from, to, seg)
          })
        })
      })
    },
    [trip, drawSeg]
  )

  /** 当天聚焦:非当天 marker/线段淡显 + 视野落到当天 marker */
  const applyDayFocus = useCallback((map: AMapMap, bucket: OverlayBucket, focusDay: number) => {
    const dayMarkers: AMapOverlay[] = []
    bucket.forEach((rec) => {
      const dim = rec.kind !== 'badge' && rec.dayIdx !== focusDay
      rec.overlay.setOpacity?.(dim ? 0.3 : 1)
      if (rec.kind === 'marker' && rec.dayIdx === focusDay) dayMarkers.push(rec.overlay)
    })
    if (dayMarkers.length > 0) map.setFitView?.(dayMarkers, false, [70, 70, 70, 70])
  }, [])

  /* --- 内嵌地图:IO 懒建 + 切天联动 --- */

  useEffect(() => {
    if (!trip || inView || !containerRef.current) return
    const el = containerRef.current
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          io.disconnect()
        }
      },
      { rootMargin: '300px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [trip, inView])

  useEffect(() => {
    if (!trip || !inView || mapRef.current || mapError) return
    let cancelled = false
    loadAmap()
      .then((AMap) => {
        if (cancelled || !containerRef.current) return
        AMapRef.current = AMap
        const map = new AMap.Map(containerRef.current, {
          zoom: 12.5,
          mapStyle: mapStyleOf(isDarkNow()),
          viewMode: '2D',
        })
        mapRef.current = map
        overlaysRef.current = []
        buildMarkers(AMap, map, overlaysRef.current, activeDayRef.current)
        applyDayFocus(map, overlaysRef.current, activeDayRef.current)
        drawRoutesFor(AMap, map, overlaysRef.current, activeDayRef.current, routeTokenRef)
      })
      .catch(() => {
        if (!cancelled) setMapError(true)
      })
    return () => {
      cancelled = true
    }
  }, [trip, inView, mapError, buildMarkers, applyDayFocus, drawRoutesFor])

  // 卸载:销毁地图实例(进行中的规划回调因 token 失效自动丢弃)
  useEffect(
    () => () => {
      routeTokenRef.current += 1
      fsRouteTokenRef.current += 1
      infoWinsRef.current.clear()
      mapRef.current?.destroy()
      fsMapRef.current?.destroy()
    },
    []
  )

  // 切天:两份地图(内嵌/全屏)各自聚焦当天并重画路线
  useEffect(() => {
    const AMap = AMapRef.current
    if (AMap && mapRef.current) {
      applyDayFocus(mapRef.current, overlaysRef.current, activeDay)
      drawRoutesFor(AMap, mapRef.current, overlaysRef.current, activeDay, routeTokenRef)
    }
    if (AMap && fsMapRef.current) {
      applyDayFocus(fsMapRef.current, fsOverlaysRef.current, activeDay)
      drawRoutesFor(AMap, fsMapRef.current, fsOverlaysRef.current, activeDay, fsRouteTokenRef)
    }
  }, [activeDay, applyDayFocus, drawRoutesFor])

  // 暗色联动:documentElement class 变化 → 地图样式跟随
  useEffect(() => {
    if (!trip) return
    const apply = () => {
      const style = mapStyleOf(isDarkNow())
      mapRef.current?.setMapStyle(style)
      fsMapRef.current?.setMapStyle(style)
    }
    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [trip])

  /* --- 全屏总览 --- */

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    let cancelled = false
    // 打开即画全部 3 天(总览),当天聚焦;地图实例懒建一次
    const timer = window.setTimeout(() => {
      loadAmap()
        .then((AMap) => {
          if (cancelled || !fsContainerRef.current || fsMapRef.current) return
          AMapRef.current = AMap
          const map = new AMap.Map(fsContainerRef.current, {
            zoom: 12,
            mapStyle: mapStyleOf(isDarkNow()),
            viewMode: '2D',
          })
          fsMapRef.current = map
          fsOverlaysRef.current = []
          buildMarkers(AMap, map, fsOverlaysRef.current, activeDayRef.current)
          applyDayFocus(map, fsOverlaysRef.current, activeDayRef.current)
          // 一次画全部天的段(总览):统一 token,避免多天互踩导致未缓存段被丢弃
          if (trip) {
            drawRoutesFor(AMap, map, fsOverlaysRef.current, activeDayRef.current, fsRouteTokenRef, true)
          }
        })
        .catch(() => {
          if (!cancelled) setMapError(true)
        })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      // 关闭即销毁:React 条件渲染会重建容器 DOM,旧 map 绑在已卸载节点上,复用会白屏
      fsMapRef.current?.destroy()
      fsMapRef.current = null
      fsOverlaysRef.current = []
    }
  }, [fullscreen, trip, buildMarkers, applyDayFocus, drawRoutesFor])

  /* --- 渲染:三态 --- */

  if (failed) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-500 dark:text-red-400">
        <MapPinned className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0 truncate">行程规划失败:{message}</span>
      </div>
    )
  }

  if (!trip) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-line bg-surface-muted/50 text-xs text-content-secondary">
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-accent" />
        <span className="min-w-0 truncate">正在规划行程…</span>
      </div>
    )
  }

  if (mapError) {
    // 地图脚本加载失败:退化为纯时间线(行程数据仍然可用)
    return (
      <TripTimeline
        trip={trip}
        activeDay={activeDay}
        onDayChange={setActiveDay}
        focusStop={(dayIdx, stopIdx) => flashStop(dayIdx, stopIdx)}
        compact
      />
    )
  }

  const totalStops = trip.days.reduce((acc, d) => acc + d.stops.length, 0)

  return (
    <>
      <div className="rounded-xl border border-line bg-surface-muted/50 overflow-hidden">
        {/* 头部:城市 + 规模 + 预算口径 + 全屏 */}
        <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
          <div className="shrink-0 w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
            <MapPinned className="w-4 h-4 text-accent" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-content-primary truncate">
              {trip.city} {trip.days.length} 日行程
            </div>
            <div className="text-[10px] text-content-muted mt-0.5">
              {trip.days.length} 天 · {totalStops} 站 · 吃住玩 {yuan(stopsBudget)}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent/10 text-accent">
              预估 {yuan(trip.summary.budget)}
            </span>
            <button
              type="button"
              title="全屏查看"
              onClick={() => setFullscreen(true)}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-content-muted
                hover:bg-surface-subtle hover:text-content-primary transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 天 tab 行 */}
        <div className="flex items-center gap-1 px-3 pb-2 overflow-x-auto scrollbar-none">
          {trip.days.map((d, i) => (
            <button
              key={d.day}
              type="button"
              onClick={() => setActiveDay(i)}
              className={cn(
                'shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border',
                i === activeDay
                  ? 'text-white border-transparent'
                  : 'text-content-secondary border-line hover:bg-surface-subtle'
              )}
              style={i === activeDay ? { background: hexOf(d.color) } : undefined}
            >
              Day {d.day}
              <span className="opacity-70">{d.theme}</span>
            </button>
          ))}
        </div>

        {/* 地图(懒建) */}
        <div ref={containerRef} className="relative h-[260px] sm:h-[300px] w-full bg-surface-subtle" />

        {/* 时间线 */}
        <TripTimeline
          trip={trip}
          activeDay={activeDay}
          onDayChange={setActiveDay}
          focusStop={(dayIdx, stopIdx) => focusStop(dayIdx, stopIdx, false)}
          flash={flash}
          timelineRefs={timelineRefs}
          routeTick={routeTick}
        />
      </div>

      {/* 全屏总览(portal) */}
      {fullscreen &&
        createPortal(
          <div className="fixed inset-0 z-[80] bg-background flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
              <MapPinned className="w-4 h-4 text-accent shrink-0" />
              <div className="text-sm font-medium text-content-primary">
                {trip.city} {trip.days.length} 日行程
              </div>
              <div className="hidden sm:flex items-center gap-2 ml-3 text-[11px] text-content-muted">
                <span>{totalStops} 站</span>
                <span>·</span>
                <span>吃住玩 {yuan(stopsBudget)}</span>
                <span>·</span>
                <span>预估 {yuan(trip.summary.budget)}</span>
              </div>
              <button
                type="button"
                title="退出全屏(Esc)"
                onClick={() => setFullscreen(false)}
                className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs
                  text-content-secondary hover:bg-surface-subtle hover:text-content-primary transition-colors"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                退出
              </button>
            </div>

            <div className="flex-1 min-h-0 grid grid-rows-[45%_1fr] lg:grid-rows-1 lg:grid-cols-[1fr_380px]">
              <div ref={fsContainerRef} className="relative w-full h-full bg-surface-subtle" />
              <div className="min-h-0 overflow-y-auto border-t lg:border-t-0 lg:border-l border-line px-3 py-3">
                <TripTimeline
                  trip={trip}
                  activeDay={activeDay}
                  onDayChange={setActiveDay}
                  focusStop={(dayIdx, stopIdx) => focusStop(dayIdx, stopIdx, true)}
                  flash={flash}
                  timelineRefs={fsTimelineRefs}
                  fullscreen
                  routeTick={routeTick}
                />
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

/* ---------------- 时间线(内嵌/全屏共用) ---------------- */

interface TripTimelineProps {
  trip: TripData
  activeDay: number
  onDayChange: (idx: number) => void
  focusStop: (dayIdx: number, stopIdx: number) => void
  flash?: { dayIdx: number; stopIdx: number } | null
  timelineRefs?: React.MutableRefObject<Array<HTMLDivElement | null>>
  fullscreen?: boolean
  compact?: boolean
  routeTick?: number
}

function TripTimeline({
  trip,
  activeDay,
  onDayChange,
  focusStop,
  flash,
  timelineRefs,
  fullscreen,
  compact,
  routeTick = 0,
}: TripTimelineProps) {
  void routeTick // 仅作为刷新信号:段规划完成后徽章分钟数/线路名更新
  const day = trip.days[activeDay] ?? trip.days[0]
  if (!day) return null

  const dayBudget = day.stops.reduce((a, s) => a + (s.budget || 0), 0)

  return (
    <div className={cn('px-3 py-2', compact && 'px-0')}>
      {/* 当日小计 + 主题(全屏额外展示天气口径外的小计) */}
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[11px] font-medium text-content-primary">
          Day {day.day} · {day.theme}
        </span>
        <span className="text-[10px] text-content-muted">吃住玩 {yuan(dayBudget)}</span>
      </div>

      <div className="relative">
        {/* 竖向连接线 */}
        <div className="absolute left-[52px] top-2 bottom-2 w-px bg-line/70 pointer-events-none" />
        {day.stops.map((stop, si) => {
          const move = si > 0 ? day.moves[si - 1] : null
          const MoveIcon = move ? MODE_META[move].icon : null
          const cached = move && si > 0 ? routeCache.get(segCacheKey(day.stops[si - 1], stop, move)) : undefined
          const isFlash = flash?.dayIdx === activeDay && flash?.stopIdx === si
          return (
            <Fragment key={`${day.day}-${si}`}>
              {MoveIcon && move && (
                <div className="relative z-10 flex items-center gap-1.5 pl-[38px] py-1">
                  <MoveIcon className="w-3 h-3 text-content-muted" />
                  <span className="text-[10px] text-content-muted">
                    {cached
                      ? `${MODE_META[move].label}${cached.lineName ? ` ${cached.lineName}` : ''}${
                          cached.minutes ? ` · 约${cached.minutes}分钟` : ''
                        }`
                      : `${MODE_META[move].label}前往`}
                  </span>
                </div>
              )}
              <div
                ref={(el) => {
                  if (el && timelineRefs) timelineRefs.current[si] = el
                }}
              >
                <button
                  type="button"
                  onClick={() => focusStop(activeDay, si)}
                  className={cn(
                    'w-full flex items-start gap-2.5 px-2 py-1.5 rounded-lg text-left transition-all',
                    'hover:bg-surface-subtle',
                    isFlash && 'ring-2 ring-accent/60 bg-accent/5'
                  )}
                >
                  <span className="shrink-0 text-[10px] font-mono text-content-muted pt-1 w-9">{stop.time}</span>
                  <span
                    className="shrink-0 mt-1 w-2.5 h-2.5 rounded-full border-2 border-white shadow-sm"
                    style={{ background: hexOf(day.color) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-content-primary truncate">{stop.name}</span>
                      <span
                        className="shrink-0 px-1.5 py-px rounded-full text-[9px]"
                        style={{ background: `${hexOf(day.color)}1a`, color: hexOf(day.color) }}
                      >
                        {stop.tag}
                      </span>
                      {stop.cal === false && (
                        <span className="shrink-0 px-1 py-px rounded text-[9px] text-amber-700 dark:text-amber-400 bg-amber-500/10">
                          位置近似
                        </span>
                      )}
                      {stop.budget > 0 && (
                        <span className="shrink-0 ml-auto text-[10px] text-content-muted">{yuan(stop.budget)}</span>
                      )}
                    </span>
                    <span className="block text-[11px] text-content-secondary line-clamp-2 mt-0.5">{stop.desc}</span>
                  </span>
                </button>
              </div>
            </Fragment>
          )
        })}
      </div>

      {/* 全屏补充:住宿/交通建议 */}
      {fullscreen && (trip.summary.stay || trip.summary.transport) && (
        <div className="mt-3 px-2 py-2 rounded-lg bg-surface-subtle text-[11px] text-content-secondary space-y-1">
          {trip.summary.stay && (
            <div>
              <span className="text-content-muted">住宿:</span>
              {trip.summary.stay}
            </div>
          )}
          {trip.summary.transport && (
            <div>
              <span className="text-content-muted">交通:</span>
              {trip.summary.transport}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const TripMapCard = memo(TripMapCardInner)
