/**
 * 主题体系单点控制 —— 外观是**一维**的: 选设置里的「主题」等于选一件事。
 *   light / dark / system → 黑白基线(可再叠加「月白·桂花金」配色)
 *   grid                  → 格子,自带光态: 白天(正午) / 暮色(日落) / 晚上(深夜)
 * 设置面板随之分两排: 上面那排是主题(四选一),下面那排按主题切换内容 ——
 * 非格子时选配色(黑白基线 / 月白·桂花金),格子时选白天 / 暮色 / 晚上。
 *
 * CSS 侧由三个属性驱动(样式层不必知道这套一维模型):
 *   html.dark              → 明暗(格子下 = gridTone === 'night',是它唯一会写 .dark 的光态)
 *   html[data-pal]         → base | guihua | grid
 *   html[data-grid-tone]   → dawn | day | dusk | night(仅格子写,区分四个光态)
 * 格子的光态由 gridTone 决定,且不覆盖用户的明暗偏好 —— 退出格子时原样恢复。
 *
 * 三个写入方共用本模块,行为必须一致:
 *   1) src/app/layout.tsx 首帧内联脚本(不能 import,逻辑等价照抄,防首帧闪白)
 *   2) src/components/SettingsModal.tsx 外观选择器(手动)
 *   3) src/lib/settings/executor.ts AI 设置工具(update_settings 的 theme 分支)
 *
 * 历史值归一: 'dusk'(暮色·落霞)已并入格子,读取时映射为 grid。
 */

export type ThemeMode = 'light' | 'dark' | 'system'
/** 写进 html[data-pal] 的取值 */
export type PaletteId = 'base' | 'guihua' | 'grid'
/** 能出现在「配色」选择器里的 —— 格子不算配色,它是主题 */
export type SelectablePalette = Exclude<PaletteId, 'grid'>
/** 格子的四个光态(一扇窗的一天,按时间序):
 *  日出(右上低角·冷暖对峙·浅底) / 白天(正午顶光·浅底) /
 *  暮色(日落暖橙·浅底) / 晚上(深夜冷蓝·深底) */
export type GridTone = 'dawn' | 'day' | 'dusk' | 'night'
/** 光态偏好的存储取值: 具体哪一态,或 'auto'(交给时间自动决定,见 resolveAutoTone)。
 *  只有 localStorage 存这个;写到 html[data-grid-tone] 的永远是具体四值之一 ——
 *  故 CSS 侧(globals.css 的四个门控块)完全不需要知道"智能"存在 */
export type GridTonePref = GridTone | 'auto'
/** 「主题」选择器里被选中的那一项 */
export type ThemeChoice = ThemeMode | 'grid'

export const THEME_STORAGE_KEY = 'theme'
export const PALETTE_STORAGE_KEY = 'palette'
export const GRID_TONE_STORAGE_KEY = 'gridTone'

/** 月白·桂花金: 仅深色 */
export const FEST_PALETTE = 'guihua' as const
/** 格子: 日出 / 白天 / 暮色 / 晚上 */
export const GRID_PALETTE = 'grid' as const

/** 上面那排: 主题(明暗三态 + 格子) */
export const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
  { value: 'grid', label: '格子' },
]

/** 下面那排(主题 = 格子时): 格子的光态,按一天的时间序排 —— 一扇窗的四个时刻 */
export const GRID_TONES: { value: GridTone; label: string }[] = [
  { value: 'dawn', label: '日出' },
  { value: 'day', label: '白天' },
  { value: 'dusk', label: '暮色' },
  { value: 'night', label: '晚上' },
]

/** 智能光态的时段表(本地钟点,固定 —— 不随季节/经纬度变化)。
 *  from 含、to 不含;表上没覆盖到的时段(19:30–次日 05:00)归晚上,故不必列出来。
 *  ⚠ 改这张表必须同步 src/app/layout.tsx 首帧内联脚本里的同一张表(那边不能 import)。 */
export const GRID_TONE_AUTO_SLOTS: { from: number; to: number; tone: GridTone }[] = [
  { from: 5, to: 8, tone: 'dawn' },
  { from: 8, to: 17, tone: 'day' },
  { from: 17, to: 19.5, tone: 'dusk' },
]

/** 按本地时间解析出此刻应处的光态(智能选择的唯一判据,首帧脚本里有一份等价实现) */
export function resolveAutoTone(now: Date = new Date()): GridTone {
  const h = now.getHours() + now.getMinutes() / 60
  for (const slot of GRID_TONE_AUTO_SLOTS) {
    if (h >= slot.from && h < slot.to) return slot.tone
  }
  return 'night'
}

/** 下面那排(主题 ≠ 格子时): 配色 */
export const PALETTES: {
  value: SelectablePalette
  label: string
  hint: string
  swatch: string
}[] = [
  { value: 'base', label: '黑白基线', hint: '中性灰', swatch: 'rgb(63 63 70)' },
  { value: 'guihua', label: '月白·桂花金', hint: '仅深色', swatch: 'rgb(205 158 62)' },
]

/** 外观的完整状态,与设置面板的三个 state 一一对应 */
export interface Appearance {
  choice: ThemeChoice
  /** choice 不是格子时生效 */
  palette: SelectablePalette
  /** choice 是格子时生效。智能模式下它是"此刻解析出来的结果",不是用户手选值 */
  gridTone: GridTone
  /** choice 是格子时生效: 光态是否交给时间自动决定(存 'auto',见 GridTonePref) */
  gridToneAuto: boolean
}

/** 明暗模式的最终判据: system 跟随系统偏好 */
export function resolveDark(mode: ThemeMode): boolean {
  if (typeof window === 'undefined') return false
  if (mode === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches
  return mode === 'dark'
}

/**
 * 合法化:
 *   1) 格子接管明暗,「配色」这一栏对它没有意义 → 回落黑白基线
 *   2) 月白·桂花金只在「明暗 = 深色」下可用,落在浅色/跟随系统时 → 回落黑白基线
 * (跟随系统不参与 2 的判断: 系统偏好随时可能翻转,而配色是选中那一刻定下的)
 */
export function normalizeAppearance(next: Appearance): Appearance {
  if (next.choice === 'grid') return { ...next, palette: 'base' }
  if (next.palette === FEST_PALETTE && next.choice !== 'dark') return { ...next, palette: 'base' }
  return next
}

/** 只写「明暗偏好」这一个键(格子的白天/暮色不落在这里) */
function persistThemeMode(mode: ThemeMode): void {
  if (mode === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
  else localStorage.setItem(THEME_STORAGE_KEY, mode)
}

function readStoredThemeMode(): ThemeMode {
  const v = localStorage.getItem(THEME_STORAGE_KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

/** 读出当前外观 —— 选择器三个 state 的初值 */
export function readAppearance(): Appearance {
  if (typeof window === 'undefined') {
    return { choice: 'system', palette: 'base', gridTone: 'day', gridToneAuto: false }
  }

  // 未知值一律回落白天(存量只可能是 day/dusk;'night'/'dawn'/'auto' 是后续新增值)。
  // 判据逐个列出目标取值,不用"等于 day 之外都算"这类反推 —— 新增光态时不会误吃
  const storedTone = localStorage.getItem(GRID_TONE_STORAGE_KEY)
  const gridToneAuto = storedTone === 'auto'
  const gridTone: GridTone = gridToneAuto
    ? resolveAutoTone()
    : storedTone === 'dawn' || storedTone === 'dusk' || storedTone === 'night'
      ? storedTone
      : 'day'
  const v = localStorage.getItem(PALETTE_STORAGE_KEY)
  // 'dusk' 是废弃的暮色·落霞配色,已并入格子
  if (v === GRID_PALETTE || v === 'dusk') {
    return { choice: 'grid', palette: 'base', gridTone, gridToneAuto }
  }

  const choice = readStoredThemeMode()
  // 存量数据里可能有"桂花金 + 浅色"这种非法组合(白天-桂花金已撤销),这里一并纠正
  const palette: SelectablePalette = v === FEST_PALETTE && choice === 'dark' ? FEST_PALETTE : 'base'
  return { choice, palette, gridTone, gridToneAuto }
}

/** 外观唯一写入路径: localStorage + <html> 的 class/attr(CSS 全部由它们驱动) */
export function applyAppearance(input: Appearance): void {
  const next = normalizeAppearance(input)
  const isGrid = next.choice === 'grid'
  const root = document.documentElement
  // 智能模式下光态以"此刻"为准: 不信任外部传进来的 gridTone,
  // 免得定时器或一份过期的 state 把一个已经过时的光态写进去
  const tone: GridTone = next.gridToneAuto ? resolveAutoTone() : next.gridTone

  // 格子下不写 theme 键 —— 用户原先的明暗偏好留着,退出格子时原样恢复
  if (isGrid) {
    const pref: GridTonePref = next.gridToneAuto ? 'auto' : tone
    localStorage.setItem(GRID_TONE_STORAGE_KEY, pref)
  } else persistThemeMode(next.choice as ThemeMode)

  if (isGrid) {
    // 四个光态里只有「晚上」是深底 —— 它是格子下唯一会写 .dark 的态
    // (日出/白天/暮色都是浅底,一律不写)。
    // 写 .dark 是必须的: 下游(toast / TauriVisualFX / 代码编辑器 / 地图卡)
    // 都靠 .dark 判断明暗,不写就会在深底上渲染浅色视觉(白输入框/亮滚动条);
    // 深底 token 由 [data-pal="grid"][data-grid-tone="night"] 压制 .dark。
    // 智能模式跨到晚上时也会走到这里 —— 即"日落自动转深色",这是设计不是副作用。
    root.setAttribute('data-grid-tone', tone)
    root.classList.toggle('dark', tone === 'night')
  } else {
    root.removeAttribute('data-grid-tone')
    root.classList.toggle('dark', resolveDark(next.choice as ThemeMode))
  }

  const palette: PaletteId = isGrid ? GRID_PALETTE : next.palette
  localStorage.setItem(PALETTE_STORAGE_KEY, palette)
  root.setAttribute('data-pal', palette)
}

/**
 * 只改明暗(给 AI 设置工具等外部入口用)。
 * 格子外观下明暗不是由 theme 决定的,这里只把偏好记下,等退出格子后再生效。
 */
export function setThemeMode(mode: ThemeMode): void {
  if (typeof window === 'undefined') return
  const cur = readAppearance()
  if (cur.choice === 'grid') {
    persistThemeMode(mode)
    return
  }
  applyAppearance({ ...cur, choice: mode })
}

/** 智能光态的复查间隔。10 分钟足够细(最粗的时段也有 2.5 小时),
 *  又不至于让一个常驻定时器变成负担 */
const AUTO_TONE_TICK_MS = 10 * 60 * 1000

/**
 * 智能光态的看门人(常驻,挂在 Providers 这个全局客户端根上):
 * 每 10 分钟查一次 + 窗口重新聚焦时补一次(合盖/切走再回来期间不会漏掉跨段),
 * **只在解析结果变了才写** —— 不跨段就一次 DOM 写入都不发生。
 * 非智能模式(手选光态)下它什么都不做,手选值不会被抢走。
 * 返回取消订阅函数,供 useEffect 清理。
 */
export function startAutoGridToneWatch(): () => void {
  if (typeof window === 'undefined') return () => {}
  let last: GridTone | null = null
  const tick = () => {
    const cur = readAppearance()
    // gridTone 这个键在退出格子后仍保留(用户手选/智能偏好要留着,回到格子时原样恢复),
    // 故这里必须连 choice 一起判 —— 否则用户在浅色/深色下待着,
    // 每当跨过时段边界都会被这个"看门人"白写一次 DOM(结果虽然相同,但没必要)
    if (!cur.gridToneAuto || cur.choice !== 'grid') {
      last = null
      return
    }
    const tone = resolveAutoTone()
    if (tone === last) return
    last = tone
    applyAppearance({ ...cur, gridTone: tone })
  }
  tick()
  const timer = window.setInterval(tick, AUTO_TONE_TICK_MS)
  const onWake = () => tick()
  window.addEventListener('focus', onWake)
  document.addEventListener('visibilitychange', onWake)
  return () => {
    window.clearInterval(timer)
    window.removeEventListener('focus', onWake)
    document.removeEventListener('visibilitychange', onWake)
  }
}