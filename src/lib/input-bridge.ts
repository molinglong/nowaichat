/**
 * 输入框桥接 —— 让 props 链够不着的深层组件(如 MarkdownRenderer 里的代码块)
 * 把文本注入聊天输入框,而不必层层透传回调(会触碰 MessageBubble 等组件的
 * 自定义 memo 比较函数,风险高)。
 *
 * ChatInput 监听同名事件把文本追加到输入框;草稿持久化由其既有 effect 自动完成。
 */
export const INPUT_INSERT_EVENT = 'aichatt:insert-to-input'

export function insertTextToInput(text: string) {
  if (typeof window === 'undefined' || !text) return
  window.dispatchEvent(new CustomEvent(INPUT_INSERT_EVENT, { detail: { text } }))
}
