/**
 * Tauri 桌面构建期可被替换的常量。
 *
 * 使用方式:在打包前用 sed / 构建脚本替换这两个值;
 * 部署到 Web 时保持现状(指向相对路径)。
 *
 * - NEXT_PUBLIC_API_BASE: 留空走相对路径(配合 nginx / 同源);
 *   如果桌面端要打到一个独立的 API 域名,改这里为 'https://api.example.com'
 * - IS_TAURI_BUILD: 仅供条件分支用,如关闭某些仅在 Web 端合理的动画。
 *   当前代码用运行时检测 __TAURI_INTERNALS__,这个常量暂时无人引用,
 *   留作未来扩展接口,不会影响现有行为。
 *
 * 注:这两个常量目前没有 import,因为 static export 后 WebView 启动时
 * fetch('/api/...') 会自动走相对路径。如果将来要分发独立 API,加个
 * fetch wrapper 即可。
 */
export const NEXT_PUBLIC_API_BASE = ''
export const IS_TAURI_BUILD = false
