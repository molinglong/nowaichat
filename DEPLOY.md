# aichatt 部署指南

把整个应用（Next.js + PostgreSQL + Nginx + Let's Encrypt）打包成 Docker，一键部署到任意 VPS。

---

## 架构

```
                        ┌──────────────────────────────────┐
                        │   Nginx (反向代理 + HTTPS)        │
   用户 ─── HTTPS ────▶ │   - Let's Encrypt 自动续期        │
                        │   - /uploads/ 直接静态服务         │
                        └──────────────┬───────────────────┘
                                       │ HTTP
                        ┌──────────────▼───────────────────┐
                        │   Next.js (standalone Docker)     │
                        │   - app 容器,expose 3000          │
                        │   - uploads 用命名卷持久化         │
                        └──────────────┬───────────────────┘
                                       │ postgresql://
                        ┌──────────────▼───────────────────┐
                        │   PostgreSQL 16                   │
                        │   - 数据卷 aichatt_pgdata 持久化   │
                        └──────────────────────────────────┘
```

所有服务都在 `deploy/docker-compose.yml` 里编排，互相用 Docker network 通信，Postgres 只在内网暴露。

---

## 前置要求

1. **一台 VPS**：Ubuntu 22.04+ / Debian 12+，建议 1 vCPU / 1 GB RAM 起
2. **一个域名**，A 记录指向 VPS 公网 IP
3. **本地**：能 SSH 到 VPS，把代码传上去

---

## 第一步：VPS 初始化（只需一次）

登录 VPS：

```bash
ssh root@your-vps-ip
```

如果 VPS 是新装的系统，先做基本设置（可选）：

```bash
apt update && apt upgrade -y
# 改时区
timedatectl set-timezone Asia/Shanghai
```

把代码传到 VPS。本项目根目录提供了 `deploy-push.bat`（Windows），或者直接用 rsync：

```bash
# 在本地项目根目录执行
rsync -avz --delete \
  --exclude 'node_modules' --exclude '.next' --exclude '.git' \
  --exclude 'src/generated' --exclude 'uploads' --exclude '*.db*' \
  --exclude '.env' --exclude '.env.local' --exclude 'deploy/backups' \
  ./ root@your-vps-ip:/root/aichatt/
```

VPS 上进入项目目录：

```bash
cd /root/aichatt
ls deploy/
# 应该看到: docker-compose.yml  deploy.sh  nginx/  .env.production.example
```

---

## 第二步：填环境变量

```bash
cd deploy
cp .env.production.example .env.production
vim .env.production
```

要填的关键值：

| 变量 | 说明 | 生成方式 |
|---|---|---|
| `POSTGRES_PASSWORD` | 数据库密码 | 强随机字符串 |
| `AUTH_SECRET` | NextAuth 加密密钥 | `openssl rand -base64 32` |
| `AUTH_URL` | 访问地址 | `https://your-domain.com`（末尾不要 `/`） |
| `DOMAIN` | 你的域名 | `your-domain.com` |
| `CERTBOT_EMAIL` | Let's Encrypt 注册邮箱 | `you@example.com` |

---

## 第三步：一键部署

Docker 已装好(就是你现在的场景):

```bash
cd /root/aichatt/deploy
chmod +x deploy.sh
./deploy.sh init
```

脚本会自动：
1. 检测 Docker（已装则跳过）
2. 检查域名 DNS 是否已指向本机
3. 临时启动 Nginx（仅 HTTP）申请 Let's Encrypt 证书
4. 写入 HTTPS 配置
5. 构建并启动 app + postgres + nginx
6. 执行 `prisma migrate deploy` 把表结构建出来

完成后会提示 `访问 https://your-domain.com`。

---

## DNS 还没加？先别跑 init

`./deploy.sh init` 会去申请证书,如果域名没解析到 VPS,会卡住。先去域名服务商加 A 记录:

| 主机记录 | 记录类型 | 记录值 |
|---|---|---|
| `@`（或子域名，比如 `chat`） | A | 你的 VPS 公网 IP |

加完后等几分钟,在 VPS 上验证：

```bash
dig +short your-domain.com
# 或
ping -c 2 your-domain.com
```

看到返回 VPS 公网 IP 就能跑 `./deploy.sh init` 了。

如果你**暂时只想本地练手**,不想等 DNS,可以先用纯 HTTP + 直接暴露 3000 端口的方式跑起来 —— 见文档末尾 "本地无域名部署" 那一节。

---

## 日常运维

```bash
cd /root/aichatt/deploy

./deploy.sh ps      # 看容器状态
./deploy.sh logs    # 跟所有日志
./deploy.sh logs app    # 只看 app 日志
./deploy.sh restart app # 重启 app
./deploy.sh shell app   # 进 app 容器调试
./deploy.sh backup  # 备份数据库 → deploy/backups/
./deploy.sh update  # git pull + 重新部署
./deploy.sh down    # 停掉所有服务（数据保留）
```

---

## 更新代码

本地开发完成后：

```bash
# 1. 本地提交
git add -A
git commit -m "feat: xxx"

# 2. 推到远程
git push

# 3. VPS 上拉取并重新部署
ssh root@your-vps-ip
cd /root/aichatt
git pull
./deploy.sh update
```

`update` 命令会：
- 重新构建 app 镜像（带新代码）
- 重启容器
- 自动跑 `prisma migrate deploy`（如果有新迁移文件）

---

## 数据备份与恢复

### 备份（每天建议跑一次，配合 cron）

```bash
./deploy.sh backup
# 产出: deploy/backups/aichatt-20260827-103000.dump
```

加 cron 自动备份：

```bash
crontab -e
# 每天凌晨 3 点备份,保留 30 天
0 3 * * * /root/aichatt/deploy/deploy.sh backup >> /var/log/aichatt-backup.log 2>&1
```

### 恢复

```bash
cd /root/aichatt/deploy
docker exec -i aichatt-postgres pg_restore -U admin -d aichatt --clean --if-exists < backups/aichatt-20260827-103000.dump
```

---

## SSL 证书续期

Let's Encrypt 证书 90 天过期。certbot 容器虽然常驻但只在 `init` 时跑了一次申请。

加一个 cron 续期：

```bash
crontab -e
# 每月 1 号和 15 号尝试续期,reload nginx
0 3 1,15 * * cd /root/aichatt/deploy && docker compose run --rm certbot renew && docker compose exec nginx nginx -s reload >> /var/log/aichatt-certbot.log 2>&1
```

---

## 故障排查

### 应用起不来

```bash
./deploy.sh logs app
```

常见原因：
- `AUTH_SECRET` 没设置或太短
- `AUTH_URL` 和实际访问地址不一致（注意 https vs http、末尾斜杠）
- `DATABASE_URL` 拼错 → 检查 `.env.production`

### 数据库连不上

```bash
./deploy.sh logs postgres
docker exec -it aichatt-postgres pg_isready -U admin -d aichatt
```

### 证书申请失败

```bash
# 检查域名解析
dig +short your-domain.com
# 检查 80 端口是否被宿主机其他东西占
ss -tlnp | grep ':80'
```

### 想完全重置（清数据重新开始）

```bash
docker compose down -v   # -v 会同时删数据卷,数据全清
./deploy.sh init
```

---

## 本地无域名部署（IP-only，先验证能跑通）

如果你 DNS 还没配好，或者就想先在 VPS 上跑起来看看能不能跑通，先不要 nginx/certbot 这一套：

```bash
cd /root/aichatt

# 1) 把 dev 用的 docker-compose 起 postgres
docker compose -f docker-compose.yml up -d

# 2) 等数据库就绪
docker exec aichatt-postgres pg_isready -U admin -d aichatt

# 3) 临时 build + 跑 app（直接绑 3000 端口，不走 nginx）
docker build -t aichatt-app .
docker run -d --name aichatt-app \
  --network host \
  -e DATABASE_URL="postgresql://admin:admin123@localhost:5432/aichatt?schema=public" \
  -e AUTH_SECRET="$(openssl rand -base64 32)" \
  -e AUTH_URL="http://你的VPS公网IP:3000" \
  -e NODE_ENV=production \
  -v aichatt_uploads:/app/uploads \
  aichatt-app

# 4) 跑数据库迁移
docker exec aichatt-app npx prisma migrate deploy
```

然后浏览器访问 `http://VPS公网IP:3000` 就能看到。

**注意**：这是 IP+HTTP 模式，仅用于验证能跑通。NextAuth 在 HTTP 下登录 cookie 可能有问题，所以**注册用户这一步可能报错**——这正常。等你配好域名 + HTTPS 后再正式上线。

跑通了就停掉，进入正式流程：

```bash
docker rm -f aichatt-app
cd deploy
./deploy.sh init
```

---

## 文件清单

```
deploy/
├── docker-compose.yml          # 生产编排
├── deploy.sh                   # VPS 一键管理脚本
├── .env.production.example     # 环境变量模板
├── nginx/
│   ├── conf.d/
│   │   ├── app.conf            # HTTP-only 占位,证书申请用
│   │   └── app.conf.https.tmpl # HTTPS 模板,deploy.sh 渲染
│   └── html/                   # nginx 默认页占位
└── backups/                    # pg_dump 输出目录

项目根/
├── Dockerfile                  # 多阶段构建,产出 standalone 镜像
├── .dockerignore               # 挡掉 node_modules 等
├── deploy-push.bat             # Windows 上 rsync 到 VPS 的小工具
└── DEPLOY.md                   # 本文件
```

---

## 安全 checklist

部署完第一件事：

- [ ] 改了 `POSTGRES_PASSWORD` 为强随机串
- [ ] 改了 `AUTH_SECRET` 为 `openssl rand -base64 32` 输出
- [ ] 改了数据库默认用户名 `admin`（在 docker-compose.yml 里改 `POSTGRES_USER` 和 `.env.production`）
- [ ] SSH 改成密钥登录，关掉密码登录
- [ ] VPS 防火墙开了 80/443，**没**开 5432（Postgres 不对外暴露）
- [ ] 配置了数据库自动备份
- [ ] 配置了 certbot 自动续期
