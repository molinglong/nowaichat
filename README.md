# aichatt

全栈 AI 学习助手 —— 不只是聊天，还为学习场景而生（错题本、间隔复习、教学模式）。

## 核心功能

- **多模型接入**：OpenAI / Anthropic / Google / DeepSeek 开箱即用，另支持 13+ 服务商适配与自定义 OpenAI 兼容端点
- **面具系统**：内置精选面具库 + 用户自定义人格（系统提示词 + few-shot + 风格预设）
- **长期记忆**：对话后自动提取记忆、矛盾自动替换、bigram 相关度注入；支持从 ChatGPT / Claude / Gemini 等导出记忆一键导入
- **对比模式**：同一轮提问并行对比多个模型回答，投票记录偏好
- **临时聊天模式**：访客密码进入隔离区，服务端强制隔离，借号不暴露主账号记忆
- **教学模式与错题本**：对话生成结构化课程，错题一键入库，FSRS 间隔复习调度
- **生图工作台**：文生图 / 以图生图 / 局部重绘，支持自定义 OpenAI 兼容生图端点
- **文件上传**：PDF 与文本解析注入上下文
- **流式恢复**：生成中断后重进可恢复，进程崩溃自动兜底
- **长对话摘要压缩**：接近上下文窗口时自动分代压缩，防止失忆

## 技术栈

Next.js 14 (App Router) · React 18 · TypeScript · Prisma 7 + PostgreSQL (driver adapter) · NextAuth v5 · Tailwind CSS · AI SDK · Zustand · React Query · Tauri 2 (桌面端) · Docker

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（复制 .env.production.example 或自行创建 .env）
#    必填：DATABASE_URL、NEXTAUTH_SECRET、NEXTAUTH_URL

# 3. 初始化数据库（PostgreSQL）
npx prisma migrate deploy

# 4. 启动开发服务器
npm run dev
# 打开 http://localhost:3456
```

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发服务器（端口 3456） |
| `npm run build` / `npm start` | 生产构建 / 启动 |
| `npm run db:migrate` | Prisma 迁移（开发） |
| `npm run db:studio` | Prisma Studio 数据查看 |
| `npm run tauri:dev` | Tauri 桌面端开发模式 |

## 部署

提供 Docker 部署方案，详见 [DEPLOY.md](./DEPLOY.md) 与 [deploy/](./deploy/) 目录。

## License

MIT
