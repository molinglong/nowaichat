# Tauri 桌面客户端

把现有的 Next.js AI Chat 应用打包成 Windows 桌面客户端。

## 当前状态

| 模式 | 命令 | 状态 | 说明 |
|---|---|---|---|
| 开发 | `npm run tauri:dev` | ✅ 可用 | 加载 Next.js dev server (`http://localhost:3456`),所有页面正常工作 |
| 构建 | `npm run tauri:build` | ✅ 可用 | 远程壳模式:打包本地 `splash/` 兕底页,启动后探测并跳转 `https://chat.yuban.icu` |

## 静态导出改造 (已退役,留作本地化路线参考)

> 2026-09 起生产构建改为「远程壳」模式:不再静态导出,窗口经 `src-tauri/splash/`
> 兑底页探测 `https://chat.yuban.icu` 可达后整窗跳转。零后端/认证/前端改动。
> `next.config.desktop.mjs`、`src/lib/desktop-build.ts`、`desktop-placeholder/`
> 保留未删,将来做本地数据/离线模式(B 路线)时可复活。以下改造记录原文保留:

`/chat/c/[id]` 已从 Server Component 改造为 Client Component:

- **新增** `src/app/api/conversations/[id]/route.ts` 的 GET handler(返回完整对话数据 + 消息列表)
- **改造** `src/app/chat/c/[id]/page.tsx` 为 Client Component,用 `useSession` + `fetch` 拉取数据
- **新增** `next.config.desktop.mjs` 桌面专用配置(`output: 'export'`、`trailingSlash`、`images.unoptimized`)
- **新增** `src/lib/desktop-build.ts` 构建期常量(`NEXT_PUBLIC_API_BASE`、`IS_TAURI_BUILD`)

API 现在通过相对路径 `/api/...` 调用。前端 `fetch` 在 WebView 内请求本地或远端域名,跟 Web 端行为一致。

## 首次跑生产构建的注意事项

`npm run tauri:build` 会直接调 `tauri build`,打包本地 `splash/` 兑底页,产出 `.exe` 到 `src-tauri/target/release/bundle/`(不再静态导出 Next.js,无需 `next build`)。

需要先确认的:
- ✅ Rust toolchain 已装
- 远程域名 `https://chat.yuban.icu` 可从用户网络访问(壳启动后探测该地址,不可达显示兑底页+重试)

## 桌面端运行架构 (远程壳模式)

```
┌─ Tauri WebView (Rust) ──────────────────────┐
│                                              │
│ dev : localhost:3456 (Next dev server, HMR)  │
│ prod: splash/ 兑底页                         │
│        └─ 探测可达 → 整窗跳转远程             │
│             https://chat.yuban.icu           │
│             (与 Web 同源:cookie/CORS 无感,   │
│              API 走同一域名,前端零改动)       │
│                                              │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
        VPS Next.js Server (含 API + DB)
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
│   └── default.json    权限白名单(窗口控制命令;remote 覆盖 chat.yuban.icu)
├── splash/             本地兑底页(探测可达后跳转远程域名)
│   ├── config.js       远程域名唯一出处(AICHATT_ORIGIN)
│   ├── index.html      main 窗口兑底页
│   └── buddy/
│       └── index.html  搭子窗口兑底页
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
- `src-tauri/target/release/bundle/nsis/*.exe` - NSIS 安装包(主分发格式;远程壳模式下体积仅 ~2MB)

> MSI 已从 bundle.targets 移除:WiX 工具(wix311-binaries.zip ~34MB)在直连 GitHub 超时/
> 镜像频繁断流的网络下难以完整下载,导致默认 build 被 MSI 拖死。需要 MSI 时把
> tauri.conf.json 的 targets 加回 "msi",并确保 %LOCALAPPDATA%\tauri\WixTools 就位
> (或网络通畅时 CLI 自动下载)。

## 下一步:可选优化

- [ ] 自定义应用图标(替换 `icons/*.png`)
- [ ] 系统托盘 + 关闭到托盘
- [ ] 全局快捷键(`Ctrl+Space` 召唤浮窗)
- [ ] 自动更新(`tauri-plugin-updater`)
- [ ] 本地模型集成(llama.cpp / Ollama)
- [ ] 代码签名证书(避免 Windows Defender 误报)
- [ ] 静态资源国际化:把 `/api/*` 在打包时通过环境变量注入到 `NEXT_PUBLIC_API_BASE`