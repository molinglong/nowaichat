/**
 * iziToast 封装层
 * - 客户端单例: 全局只初始化一次
 * - 主题与现有 Tailwind 视觉体系对齐 (rounded-xl, border, soft bg)
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
    // 动态加载 JS + CSS,避免污染服务端 bundle
    // iziToast 是 CJS 包(`module.exports = ...`),在 Next.js webpack ESM 互操作下,
    // 既可能是整个 module,也可能被包成 `{ default: <module> }`。
    // 兼容两种形态,以及 iziToast 自己挂在 `.iziToast` 上的 UMD 形态。
    const [mod, cssMod] = await Promise.all([
      import('izitoast'),
      import('izitoast/dist/css/iziToast.min.css'),
    ])
    void cssMod // 仅触发 CSS 注入

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
      // 与本项目 Tailwind 视觉对齐
      layout: 2,
      balloon: false,
      maxWidth: 380,
      theme: 'light',
      // iconText 来自每次 show 调用,这里给个空字符避免 iziToast 默认行为
      iconText: '',
      // 注入主题样式: 圆角、深色背景、彩色图标背景
      onOpening: function (instance: unknown, toastEl: HTMLElement) {
        const iconEl = toastEl.querySelector('.iziToast-icon')
        if (iconEl instanceof HTMLElement) {
          iconEl.style.display = 'inline-flex'
          iconEl.style.alignItems = 'center'
          iconEl.style.justifyContent = 'center'
          iconEl.style.fontWeight = '700'
          iconEl.style.fontSize = '14px'
          iconEl.style.color = '#ffffff'
        }
        toastEl.style.borderRadius = '12px'
        toastEl.style.boxShadow = '0 10px 25px -10px rgba(0,0,0,0.15)'
      },
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

const KIND_CONFIG: Record<
  ToastKind,
  { color: string; backgroundColor: string; iconText: string }
> = {
  // 颜色贴近现有 Tailwind 视觉
  // iconText 是纯 Unicode 符号,无字体依赖
  // .iziToast-icon 元素本身的样式由注入的 CSS 接管(圆形背景)
  error: {
    color: '#ef4444',
    backgroundColor: '#fef2f2',
    iconText: '!',
  },
  success: {
    color: '#10b981',
    backgroundColor: '#ecfdf5',
    iconText: '✓',
  },
  warning: {
    color: '#f59e0b',
    backgroundColor: '#fffbeb',
    iconText: '!',
  },
  info: {
    color: '#6366f1',
    backgroundColor: '#eef2ff',
    iconText: 'i',
  },
}

function buildKindOptions(kind: ToastKind, opts: ToastOptions) {
  const cfg = KIND_CONFIG[kind]
  // 错误类默认更长(8s),其他 5s。
  // 鼠标悬浮会暂停倒计时,所以即使默认长也不会影响用户操作。
  const defaultTimeout = kind === 'error' ? 8000 : 5000
  return {
    title: opts.title ?? defaultTitle(kind),
    message: opts.message,
    color: cfg.color,
    backgroundColor: cfg.backgroundColor,
    iconText: cfg.iconText,
    iconColor: cfg.color,
    class: `iziToast--aichatt`,
    // 仅在显式传入时才附加 position,否则会覆盖 settings() 默认值,
    // 且 iziToast 不接受 undefined(它会 console.warn 并丢弃整个 toast)
    ...(opts.position ? { position: opts.position } : {}),
    timeout: opts.timeout ?? defaultTimeout,
    titleSize: '13px',
    titleColor: cfg.color,
    messageColor: '#1f2937',
    messageSize: '13px',
    progressBarColor: cfg.color,
    progressBarOpacity: 0.4,
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