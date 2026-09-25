/**
 * Monaco 共享配置 —— 本地文件编辑器(FileEditorPanel)与代码编辑器(CodeEditor)共用,
 * 避免两处重复维护 lang 映射/选项/主题/资源路径。
 *
 * Monaco 资源经 loader 指向同源 /monaco/vs(public/,随应用部署,不依赖 CDN)。
 * 模块导入即配置 loader(幂等,多组件导入只生效一次)。
 */
import { loader, type BeforeMount } from '@monaco-editor/react'

/** Monaco 本体走同源静态资源(见 scripts/copy-monaco.cjs 拷贝到 public/monaco/vs) */
export const MONACO_VS_PATH = '/monaco/vs'

/** 自定义主题名(供 theme prop 引用) */
export const AICHATT_LIGHT_THEME = 'aichatt-light'
export const AICHATT_DARK_THEME = 'aichatt-dark'

// 模块导入即配置资源路径(幂等)
loader.config({ paths: { vs: MONACO_VS_PATH } })

/** 扩展名 → Monaco 语言 id(未收录的落 plaintext,不吞内容) */
export function langFromPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    json: 'json', jsonc: 'json', md: 'markdown', mdx: 'markdown',
    css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
    py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
    sh: 'shell', bash: 'shell', ps1: 'powershell', bat: 'bat',
    yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', sql: 'sql', lua: 'lua', php: 'php', rb: 'ruby',
  }
  return map[ext] ?? 'plaintext'
}

/** Monaco 通用选项:紧凑字号、无 minimap,贴合聊天侧栏密度 */
export const EDITOR_OPTIONS = {
  fontSize: 12.5,
  lineHeight: 21,
  fontLigatures: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  renderLineHighlight: 'none' as const,
  smoothScrolling: true,
  padding: { top: 10, bottom: 10 },
  automaticLayout: true,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
}

/** 中性灰编辑器主题:底色与面板表面一致,不出现白色补丁 */
export function defineThemes(monaco: Parameters<BeforeMount>[0]) {
  monaco.editor.defineTheme(AICHATT_LIGHT_THEME, {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: { 'editor.background': '#ffffff', 'editorGutter.background': '#ffffff' },
  })
  monaco.editor.defineTheme(AICHATT_DARK_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: { 'editor.background': '#1c1c1e', 'editorGutter.background': '#1c1c1e' },
  })
}
