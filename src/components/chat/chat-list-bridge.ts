import type { UIMessage } from 'ai'

/**
 * 聊天消息列表性能桥 —— 模块级单例,跨组件共享,不进 React 状态。
 *
 * 三个职责:
 *  1) messageHeightStore: 每条消息真实渲染高度缓存。
 *     MessageBubble 用共享 ResizeObserver 测得后写入,containIntrinsicSize 优先取用
 *     (估算值只在首帧兜底);虚拟化的 estimateSize 也读它 —— 二次打开会话直接命中
 *     真实高度,没有校正抖动。
 *  2) estimatePlaceholderHeight / estimateMessageHeight: 高度估算(首帧占位用),
 *     自 MessageBubble 平移至此供两处共用。
 *  3) ListScrollFacade: 虚拟化模式下屏外消息不在 DOM,OutlineSidebar 的 scroll-spy
 *     与跳转不能再查节点 —— MessageList 挂载时在这里注册一个由虚拟化测量数据驱动的
 *     facade,卸载时注销;未注册(非虚拟化路径)时侧栏回退走 DOM 查询。
 */

/** 消息真实高度缓存: messageId → px(测量值,永远比估算准) */
const heights = new Map<string, number>()

export const messageHeightStore = {
  get(id: string): number | undefined {
    return heights.get(id)
  },
  set(id: string, px: number): void {
    heights.set(id, Math.max(1, Math.round(px)))
  },
}

/**
 * 占位高度按内容粗估:偏差越小,上滑进入视口时滚动锚定跳变越小。
 * 此前统一 180px,长消息可跳数千 px;超长消息(>2600px)直接豁免,
 * 宁可集中排版也不让滚动条跳变。
 */
export function estimatePlaceholderHeight(text: string, reasoning: string, attachmentCount: number): number {
  let h = 120
  const len = text.length + reasoning.length
  if (len > 60) h += Math.min(len * 0.75, 2400)
  const codeFences = Math.floor((text.match(/```/g)?.length ?? 0) / 2)
  h += Math.min(codeFences, 6) * 320
  h += attachmentCount * 240
  return Math.min(h, 4000)
}

/** UIMessage 版估算: 虚拟化 estimateSize 用(无 DOM 可测时的首帧占位) */
export function estimateMessageHeight(message: UIMessage): number {
  let text = ''
  let reasoning = ''
  for (const p of message.parts) {
    if (p.type === 'text') text += p.text
    else if (p.type === 'reasoning') reasoning += p.text
  }
  const atts = (message as { attachments?: unknown[] }).attachments
  return estimatePlaceholderHeight(text, reasoning, Array.isArray(atts) ? atts.length : 0)
}

/* ── 消息高度测量: 全列表共享一个 ResizeObserver ────────────────────────── */

type HeightCallback = (heightPx: number) => void
const observed = new Map<Element, HeightCallback>()

let sharedRO: ResizeObserver | null = null
function getRO(): ResizeObserver {
  if (!sharedRO) {
    sharedRO = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cb = observed.get(entry.target)
        if (cb) cb(entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height)
      }
    })
  }
  return sharedRO
}

/** 观察 wrapper 高度(挂载时调用;ref 回调解挂时 unobserveMessageHeight) */
export function observeMessageHeight(el: Element, cb: HeightCallback): void {
  observed.set(el, cb)
  getRO().observe(el)
}

export function unobserveMessageHeight(el: Element): void {
  if (!observed.delete(el)) return
  sharedRO?.unobserve(el)
}

/* ── 虚拟化列表 facade: MessageList 注册,OutlineSidebar 消费 ──────────────── */

export interface ListScrollFacade {
  /**
   * 滚动容器内容坐标系里 topPx 处(向下取最近的消息起点)的消息下标。
   * 与 DOM 方案「最后一条 offsetTop ≤ topPx 的消息」等价。null = 不可知。
   */
  messageIndexAtTop(topPx: number): number | null
  /** 平滑滚动到指定消息;返回 false = 未处理(调用方回退 DOM 方案) */
  jumpToMessage(messageId: string): boolean
}

const facadeRef: { current: ListScrollFacade | null } = { current: null }

export function registerListScrollFacade(facade: ListScrollFacade | null): void {
  facadeRef.current = facade
}

export function getListScrollFacade(): ListScrollFacade | null {
  return facadeRef.current
}

/* ── 进入会话贴底:ChatPanel(单聊)与 CompareLane(对比泳道)共用 ──────────── */

/**
 * 把滚动容器一次性贴到最新一条消息,并逐帧校正首帧不可信的高度
 * (虚拟化用估算高度;非虚拟化有图片/公式/字体异步撑高)。
 * 连续 stableFrames 帧 scrollHeight 不变才收手,maxFrames 封顶防长尾。
 * 让路条件:容器被卸载/隐藏(display:none 时 clientHeight=0)、上一帧的赋值被用户
 * 向上滚走、或 isFollowing 返回 false —— 首帧不判 isFollowing,此时容器还停在顶部。
 */
export function pinScrollToBottom(
  el: HTMLElement,
  isFollowing: () => boolean = () => true,
  { stableFrames = 8, maxFrames = 120 }: { stableFrames?: number; maxFrames?: number } = {}
): void {
  let frames = 0
  let stable = 0
  let lastHeight = -1
  let assigned = -1
  const step = () => {
    if (!el.isConnected || el.clientHeight === 0) return
    if (assigned >= 0 && el.scrollTop < assigned - 2) return
    if (frames > 0 && !isFollowing()) return
    el.scrollTop = el.scrollHeight
    assigned = el.scrollTop
    stable = el.scrollHeight === lastHeight ? stable + 1 : 0
    lastHeight = el.scrollHeight
    if (stable >= stableFrames || ++frames >= maxFrames) return
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}
