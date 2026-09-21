/**
 * 高德 JS API 2.0 单例加载器(浏览器端)。
 *
 * Key 与安全密钥经 GET /api/amap-config 下发(登录态),不在构建期注入,
 * 便于换 Key / 配置域名白名单。多张行程卡片共享一次脚本加载(单例 Promise)。
 * 安全密钥为「Web端(JS API)」类型 Key 专属;仅配置了它的 Key 走 v=2.0。
 */

/** 高德 JS API 最小类型面(未安装官方 @types,按本项目用法声明;新用法在此补成员) */
export interface AMapMap {
  add: (overlay: object | object[]) => void
  remove: (overlay: object | object[]) => void
  destroy: () => void
  setCenter: (position: [number, number]) => void
  setZoom: (zoom: number, immediately?: boolean) => void
  setMapStyle: (style: string) => void
  setFitView?: (overlays?: object[] | object, immediately?: boolean, avoid?: number[]) => void
  getZoom?: () => number
}

export interface AMapOverlay {
  setMap?: (map: AMapMap | null) => void
  setOpacity?: (opacity: number) => void
  on?: (event: string, handler: (e?: unknown) => void) => void
}

export interface AMapInfoWindow {
  open: (map: AMapMap, position: [number, number]) => void
  close: () => void
}

/** 路径规划器(Walking/Transfer/Driving 插件实例的共同形状) */
export interface AMapPlanner {
  search: (
    origin: [number, number],
    dest: [number, number],
    callback: (status: string, result: unknown) => void
  ) => void
}

export interface AMapNamespace {
  Map: new (container: HTMLElement | string, options?: Record<string, unknown>) => AMapMap
  Marker: new (options: Record<string, unknown>) => AMapOverlay
  Polyline: new (options: Record<string, unknown>) => AMapOverlay
  InfoWindow: new (options: Record<string, unknown>) => AMapInfoWindow
  plugin: (names: string[], callback?: () => void) => void
  Walking?: new (options: Record<string, unknown>) => AMapPlanner
  Transfer?: new (options: Record<string, unknown>) => AMapPlanner
  Driving?: new (options: Record<string, unknown>) => AMapPlanner
}

interface AmapConfig {
  key?: string
  securityJsCode?: string
}

let loadPromise: Promise<AMapNamespace> | null = null

export function loadAmap(): Promise<AMapNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("loadAmap 仅可在浏览器端调用"))
  }
  if (window.AMap) return Promise.resolve(window.AMap)
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    try {
      const res = await fetch("/api/amap-config")
      if (!res.ok) throw new Error(`地图配置获取失败(${res.status})`)
      const cfg = (await res.json()) as AmapConfig
      if (!cfg.key) throw new Error("地图服务未配置")

      // 安全密钥必须在脚本加载前设置(官方要求)
      if (cfg.securityJsCode) {
        window._AMapSecurityConfig = { securityJsCode: cfg.securityJsCode }
      }

      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script")
        script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(cfg.key!)}`
        script.onload = () => resolve()
        script.onerror = () => reject(new Error("高德地图脚本加载失败"))
        document.head.appendChild(script)
      })

      if (!window.AMap) throw new Error("高德地图脚本加载异常")
      return window.AMap
    } catch (err) {
      // 失败重置单例,允许后续(配置修正后)重试
      loadPromise = null
      throw err
    }
  })()
  return loadPromise
}

declare global {
  interface Window {
    AMap?: AMapNamespace
    _AMapSecurityConfig?: { securityJsCode: string }
  }
}
