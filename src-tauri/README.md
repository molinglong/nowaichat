# Tauri 桌面客户端

把现有的 Next.js AI Chat 应用打包成 Windows 桌面客户端。

## 当前状态

| 模式 | 命令 | 状态 | 说明 |
|---|---|---|---|
| 开发 | `npm run tauri:dev` | ✅ 可用 | 加载 Next.js dev server (`http://localhost:3000`),所有页面正常工作 |
| 构建 | `npm run tauri:build` | ✅ 可用 | 自动跑 `next build --config next.config.desktop.mjs` 导出到 `out/`,然后 Tauri 打包 |

## 静态导出改造 (已完成)

`/chat/c/[id]` 已从 Server Component 改造为 Client Component:

- **新增** `src/app/api/conversations/[id]/route.ts` 的 GET handler(返回完整对话数据 + 消息列表)
- **改造** `src/app/chat/c/[id]/page.tsx` 为 Client Component,用 `useSession` + `fetch` 拉取数据
- **新增** `next.config.desktop.mjs` 桌面专用配置(`output: 'export'`、`trailingSlash`、`images.unoptimized`)
- **新增** `src/lib/desktop-build.ts` 构建期常量(`NEXT_PUBLIC_API_BASE`、`IS_TAURI_BUILD`)

API 现在通过相对路径 `/api/...` 调用。前端 `fetch` 在 WebView 内请求本地或远端域名,跟 Web 端行为一致。

## 首次跑生产构建的注意事项

`npm run tauri:build` 会:

1. 自动跑 `next build --config next.config.desktop.mjs` → 产出 `out/`
2. 调 `tauri build` → 产出 `.exe` 到 `src-tauri/target/release/bundle/`

需要先确认的:
- ✅ Rust toolchain 已装
- ✅ 数据库可以连(`prisma generate` + 跑过迁移)
- ✅ Prisma Client 已生成(`npm run db:generate`)
- ⚠️ 静态导出**不**包含 `/api/*` 路由 —— API 路由仍由现有部署(nginx / standalone server)提供。WebView 通过相对路径访问它们。如果你的 Web 是部署在域名 `chat.example.com` 上,Tauri 也吃这个域名 + 路径。

## 桌面端运行架构 (当前)

```
┌─ Tauri WebView (Rust) ──────────────────────┐
│                                              │
│  localhost:3000 (dev)  OR  out/*.html (prod) │
│       │                       │              │
│       └────── fetch /api/... ─┘              │
│                                              │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
        现有 Next.js Server (含 API + DB)
```

## macOS 风格红绿灯

窗口控制按钮遵循 macOS 约定:
- 🔴 红 = 关闭窗口
- 🟡 黄 = 最小化
- 🟢 绿 = 进入/退出全屏(不是 Windows 的"最大化")

附加行为:
- 双击标题栏空白处 = 切换最大化(Windows 习惯,补充 macOS 红绿灯的缺失)
- 整个标题栏可拖动(按钮除外)

## 目录结构

```
src-tauri/
├── Cargo.toml          Rust 包配置
├── tauri.conf.json     Tauri 应用配置(窗口、图标、打包)
├── build.rs            Cargo 构建脚本
├── capabilities/
│   └── default.json    权限白名单(仅允许自定义窗口控制命令)
├── icons/              应用图标(目前是占位 PNG/ICO)
└── src/
    ├── main.rs         入口(Windows release 隐藏控制台)
    └── lib.rs          Tauri 命令注册 + 窗口控制逻辑
```

## 前端相关

- `src/components/TitleBar.tsx` - macOS 红绿灯组件,接受 `title` prop
- `src/lib/tauri.ts` - Tauri API 封装,Web 端开发时全部 no-op

TitleBar 已嵌入 `src/app/layout.tsx`,Web 端开发时也会渲染(只是按钮点击不响应)。

## 开发

### 前置依赖

1. **Rust** (1.77+):https://rustup.rs
2. **Tauri 系统依赖** (Windows):
   - Microsoft Visual Studio C++ Build Tools
   - WebView2 (Win10/11 通常自带)

### 跑起来

```bash
# 安装 npm 依赖(已装 @tauri-apps/cli 和 @tauri-apps/api)
npm install

# 启动 Tauri 开发模式
npm run tauri:dev
```

`tauri:dev` 会先自动跑 `npm run dev`(Next.js dev server 在 3000),
然后启动 Tauri WebView 加载 `http://localhost:3000`。

修改前端代码 = HMR;修改 Rust 代码 = 自动 rebuild。

### 打包

```bash
npm run tauri:build
```

产物:
- `src-tauri/target/release/bundle/nsis/*.exe` - NSIS 安装包
- `src-tauri/target/release/bundle/msi/*.msi` - MSI 安装包

## 下一步:可选优化

- [ ] 自定义应用图标(替换 `icons/*.png`)
- [ ] 系统托盘 + 关闭到托盘
- [ ] 全局快捷键(`Ctrl+Space` 召唤浮窗)
- [ ] 自动更新(`tauri-plugin-updater`)
- [ ] 本地模型集成(llama.cpp / Ollama)
- [ ] 代码签名证书(避免 Windows Defender 误报)
- [ ] 静态资源国际化:把 `/api/*` 在打包时通过环境变量注入到 `NEXT_PUBLIC_API_BASE`