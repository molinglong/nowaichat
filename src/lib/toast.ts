/**
 * iziToast 封装层
 * - 客户端单例: 全局只初始化一次
 * - 视觉: macOS 通知式主题毛玻璃 —— 浅色=白玻璃深字,夜间=深灰玻璃白字;
 *   语义色只用于 SVG 图标点缀,不再整块染色,与全站黑白灰体系一致
 * - 暴露命令式 API,供 UI 各处调用,无需 Provider 包裹
 *
 * 注意: 仅可在 'use client' 组件 / 事件回调中使用,不要在 Server Component 中 import。
 */

import type iziToastType from 'izitoast'

type Izitoast = typeof iziToastType

let instance: Izitoast | null = null
let cssLoaded = false
let initializing = false
let initPromise: Promise<Izitoast> | null = null

async function ensureClient(): Promise<Izitoast | null> {
  if (typeof window === 'undefined') return null
  if (instance) return instance
  if (initPromise) return initPromise
  if (initializing) return null
  initializing = true

  initPromise = (async () => {
    // 动态加载 JS 即可,CSS 已由 globals.css 顶部 @import 静态内联(修 Next 14.2 css chunk 关联 bug)
    // iziToast 是 CJS 包(`module.exports = ...`),在 Next.js webpack ESM 互操作下,
    // 既可能是整个 module,也可能被包成 `{ default: <module> }`。
    // 兼容两种形态,以及 iziToast 自己挂在 `.iziToast` 上的 UMD 形态。
    const mod = await import('izitoast')

    if (!cssLoaded) cssLoaded = true

    const iziToast = (mod as any)?.iziToast ?? (mod as any)?.default ?? mod
    if (!iziToast || typeof iziToast.show !== 'function') {
      console.error('[toast] iziToast loaded but .show() not found. mod keys:', Object.keys(mod || {}))
      throw new Error('iziToast failed to load')
    }

    iziToast.settings({
      // 全局默认值,可在单次调用时覆盖
      position: 'topRight',
      timeout: 5000,
      closeOnClick: true,
      closeOnEscape: true,
      drag: true,
      // 鼠标悬浮暂停倒计时 —— 方便用户阅读/复制错误内容
      pauseOnHover: true,
      // 暂停时把进度条也停下(更直观能看到时间被冻结)
      resetOnHover: false,
      progressBar: true,
      progressBarEasing: 'linear',
      transitionIn: 'fadeInDown',
      transitionOut: 'fadeOutUp',
      // 视觉外壳不在这里注入 —— 每个 toast 通过 buildKindOptions 传入自己的
      // onOpening(会覆盖全局同名回调),携带 kind 点缀色与亮/暗两套配色
      layout: 2,
      balloon: false,
      maxWidth: 380,
      theme: 'light',
      iconText: '',
    })

    instance = iziToast
    initializing = false
    return iziToast
  })()

  return initPromise
}

export type ToastKind = 'error' | 'success' | 'warning' | 'info'

interface ToastOptions {
  title?: string
  message: string
  /** 毫秒;0 = 不自动关闭 */
  timeout?: number
  /** 覆盖默认位置 */
  position?:
    | 'topRight'
    | 'topCenter'
    | 'topLeft'
    | 'bottomRight'
    | 'bottomCenter'
    | 'bottomLeft'
    | 'center'
  /**
   * 点击 toast 主体时触发;返回 false 时不自动关闭(让调用方决定何时 hide)。
   * 设置后默认会关闭整 toast 的 closeOnClick,避免用户点了按钮又被自动关掉。
   */
  onClick?: (hide: () => void) => void | boolean
}

/**
 * 语义点缀色: 只用于 SVG 图标着色,不再染色底/标题/竖条/进度条。
 * info 用系统灰 #8e8e93 —— 与项目"单一中灰强调色"体系一致。
 */
const KIND_CONFIG: Record<ToastKind, { accent: string }> = {
  error: { accent: '#ef4444' },
  success: { accent: '#10b981' },
  warning: { accent: '#f59e0b' },
  info: { accent: '#8e8e93' },
}

/**
 * 语义图标(Lucide 描边风格): stroke 继承 currentColor,
 * 由 applyToastChrome 注入并以 KIND_CONFIG.accent 着色。
 */
const KIND_ICON: Record<ToastKind, string> = {
  error:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  success:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="8.5 12.5 11 15 15.5 9.5"/></svg>',
  warning:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
}

interface ToastPalette {
  background: string
  border: string
  titleColor: string
  messageColor: string
  shadow: string
  /** 进度条中性色: 自带透明度,不再染语义色(彩色进度条在深色玻璃上会喧宾夺主) */
  progressBar: string
  /** 深色玻璃上的深色 close × 需要反相才可见 */
  invertClose: boolean
}

/**
 * 跟随主题材质的毛玻璃配色(macOS 通知式):
 * 浅色模式=白玻璃深字,夜间模式=深玻璃白字,色值取自 globals.css 的配色体系。
 * show 时实时读取 <html>.dark,与 layout.tsx 的主题同步逻辑保持一致。
 */
function palette(): ToastPalette {
  const isDark = document.documentElement.classList.contains('dark')
  if (isDark) {
    // 夜间: 页面底 #0c0c0d / 面板 #1c1c1e,toast 取更亮一档的深灰玻璃浮起
    return {
      background: 'rgba(38,38,40,0.78)',
      border: 'rgba(255,255,255,0.1)',
      titleColor: '#f5f5f7',
      messageColor: 'rgba(255,255,255,0.68)',
      shadow: '0 12px 32px rgba(0,0,0,0.5)',
      progressBar: 'rgba(255,255,255,0.22)',
      invertClose: true,
    }
  }
  // 浅色: 页面底 #f5f5f7 / 面板 #fff,toast 取白玻璃与浅色界面同族
  return {
    background: 'rgba(255,255,255,0.72)',
    border: 'rgba(0,0,0,0.08)',
    titleColor: '#1d1d1f',
    messageColor: 'rgba(0,0,0,0.6)',
    shadow: '0 12px 32px rgba(0,0,0,0.18)',
    progressBar: 'rgba(0,0,0,0.15)',
    invertClose: false,
  }
}

/** 外壳统一样式: 毛玻璃底、描边、圆角、SVG 语义图标、字体 */
function applyToastChrome(
  toastEl: HTMLElement,
  iconSvg: string,
  accent: string,
  pal: ToastPalette,
): void {
  // 跟随全站系统字体栈,替换 iziToast 内置的 Lato/Tahoma
  toastEl.style.fontFamily = 'inherit'
  toastEl.style.borderRadius = '12px'
  toastEl.style.border = `1px solid ${pal.border}`
  // 毛玻璃: 低不透明度底色 + 大模糊半径,才能透出被覆盖的聊天内容
  toastEl.style.backdropFilter = 'blur(16px) saturate(150%)'
  const style = toastEl.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }
  style.webkitBackdropFilter = 'blur(16px) saturate(150%)'
  toastEl.style.overflow = 'hidden'
  // 纯外阴影: iziToast 自带的 ::after 阴影层(含 inset 内阴影)已在 globals.css 关闭
  toastEl.style.boxShadow = pal.shadow

  // SVG 语义图标: 复刻 iziToast 原生 icon 的绝对定位(挂在 body 左侧),
  // 同时把 texts 的 padding 让出图标宽度,避免重叠
  const bodyEl = toastEl.querySelector('.iziToast-body')
  if (bodyEl instanceof HTMLElement) {
    bodyEl.style.paddingLeft = '30px'
    const holder = document.createElement('span')
    holder.setAttribute('aria-hidden', 'true')
    holder.style.cssText = [
      'position:absolute',
      'left:0',
      'top:50%',
      'transform:translateY(-50%)',
      'display:inline-flex',
      'align-items:center',
      'justify-content:center',
      'width:20px',
      'height:20px',
      `color:${accent}`,
    ].join(';')
    holder.innerHTML = iconSvg
    bodyEl.insertBefore(holder, bodyEl.firstChild)
  }
  // iziToast 原生 icon 容器(若有)一律隐藏,避免与 SVG 图标重复
  const iconEl = toastEl.querySelector('.iziToast-icon')
  if (iconEl instanceof HTMLElement) iconEl.style.display = 'none'

  // 进度条保持中性: 轨道隐形,只留一条细倒计时线,不与图标争色
  const pbEl = toastEl.querySelector('.iziToast-progressbar')
  if (pbEl instanceof HTMLElement) pbEl.style.background = 'transparent'

  // close × 对比度: 深色玻璃上反相为白,亮玻璃上仅降透明度
  const closeEl = toastEl.querySelector('.iziToast-close')
  if (closeEl instanceof HTMLElement) {
    closeEl.style.filter = pal.invertClose ? 'invert(1)' : 'none'
    closeEl.style.opacity = '0.55'
  }
}

function buildKindOptions(kind: ToastKind, opts: ToastOptions) {
  const cfg = KIND_CONFIG[kind]
  // 错误类默认更长(8s),其他 5s。
  // 鼠标悬浮会暂停倒计时,所以即使默认长也不会影响用户操作。
  const defaultTimeout = kind === 'error' ? 8000 : 5000
  const pal = palette()
  return {
    title: opts.title ?? defaultTitle(kind),
    message: opts.message,
    backgroundColor: pal.background,
    class: `iziToast--aichatt`,
    // 仅在显式传入时才附加 position,否则会覆盖 settings() 默认值,
    // 且 iziToast 不接受 undefined(它会 console.warn 并丢弃整个 toast)
    ...(opts.position ? { position: opts.position } : {}),
    timeout: opts.timeout ?? defaultTimeout,
    titleSize: '13px',
    titleColor: pal.titleColor,
    messageColor: pal.messageColor,
    messageSize: '13px',
    progressBarColor: pal.progressBar,
    progressBarOpacity: 1,
    iconText: '',
    // per-toast onOpening 覆盖全局 settings 的同名回调,携带 kind 图标与点缀色
    onOpening: (_instance: unknown, toastEl: HTMLElement) => {
      applyToastChrome(toastEl, KIND_ICON[kind], cfg.accent, pal)
    },
  }
}

function defaultTitle(kind: ToastKind): string {
  switch (kind) {
    case 'error':
      return '出错了'
    case 'success':
      return '操作成功'
    case 'warning':
      return '请注意'
    case 'info':
      return '提示'
  }
}

/** 通用入口,内部用 */
async function show(kind: ToastKind, opts: ToastOptions): Promise<void> {
  const it = await ensureClient()
  if (!it) return
  it.show(buildKindOptions(kind, opts))
}

type ToastApi = {
  error: (message: string, opts?: Omit<ToastOptions, 'message'>) => Promise<void>
  success: (message: string, opts?: Omit<ToastOptions, 'message'>) => Promise<void>
  warning: (message: string, opts?: Omit<ToastOptions, 'message'>) => Promise<void>
  info: (message: string, opts?: Omit<ToastOptions, 'message'>) => Promise<void>
  /** 长驻 toast,需要用户主动关闭 */
  sticky: (kind: ToastKind, opts: ToastOptions) => Promise<void>
  /** 销毁所有 toast(测试 / 路由切换时使用) */
  destroy: () => Promise<void>
}

export const toast: ToastApi = {
  error: (message, opts) => show('error', { message, ...opts }),
  success: (message, opts) => show('success', { message, ...opts }),
  warning: (message, opts) => show('warning', { message, ...opts }),
  info: (message, opts) => show('info', { message, ...opts }),
  sticky: (kind, opts) => show(kind, { ...opts, timeout: 0 }),
  destroy: async () => {
    const it = await ensureClient()
    it?.destroy()
  },
}

/** 预热入口, ToasterBridge 在挂载时调用 */
export { ensureClient }

/**
 * SSR 守卫: 用于在事件回调 / effect 中预检
 */
export const isClient = () => typeof window !== 'undefined'