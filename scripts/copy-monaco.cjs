// 把 monaco-editor 的 min/vs 静态资源拷到 public/monaco/vs(npm predev/prebuild 钩子执行)。
// public/monaco 已进 .gitignore 不进仓库;Monaco 的 AMD loader 与 Worker 全部从应用
// 同源加载,不依赖 CDN(桌面端远程壳下与主应用同域,Worker 不受跨域限制)。
const fs = require('fs')
const path = require('path')

const src = path.join(__dirname, '..', 'node_modules', 'monaco-editor', 'min', 'vs')
const dest = path.join(__dirname, '..', 'public', 'monaco', 'vs')

if (!fs.existsSync(src)) {
  console.error('[copy-monaco] node_modules/monaco-editor 不存在,请先 npm install')
  process.exit(0) // 不阻塞 dev/build(如纯服务端环境);编辑器面板打开时会提示加载失败
}

fs.rmSync(dest, { recursive: true, force: true })
fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.cpSync(src, dest, { recursive: true })
console.log('[copy-monaco] public/monaco/vs 就绪')
