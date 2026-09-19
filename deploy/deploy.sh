#!/usr/bin/env bash
# =========================================================
# aichatt VPS 一键管理脚本(宝塔适配版)
# 适用: Ubuntu 22.04+ / Debian 12+, 已装宝塔 + Docker
#
# 与原版差异:
#   - 不再启动 compose 内置 nginx/certbot(80/443 归宝塔)
#   - 宝塔面板里手动加站点: 域名 chat.yuban.icu -> 反向代理 http://127.0.0.1:3001
#     SSL 也在宝塔站点设置里一键申请 Let's Encrypt
#
# 用法:
#   1) cd deploy && cp .env.production.example .env.production
#   2) 填好 .env.production (PASSWORD/SECRET/AUTH_URL)
#   3) ./deploy.sh init   # 首次: 构建 + 启动 + 迁移
#   4) ./deploy.sh up     # 更新: 重新构建 + 迁移
#   5) ./deploy.sh down   # 停止
#   6) ./deploy.sh logs   # 看日志
#   7) ./deploy.sh backup # 备份数据库
# =========================================================
set -euo pipefail

# ---------- 颜色 ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { printf "${BLUE}[$(date +%H:%M:%S)]${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[!]${NC} %s\n" "$*"; }
err()  { printf "${RED}[ERR]${NC} %s\n" "$*" 1>&2; }

# ---------- 路径与环境 ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.production"

if [ ! -f "$ENV_FILE" ]; then
  err "缺少 $ENV_FILE"
  err "请先: cp $SCRIPT_DIR/.env.production.example $ENV_FILE 并填值"
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

: "${POSTGRES_PASSWORD:?请设置 POSTGRES_PASSWORD}"
: "${AUTH_SECRET:?请设置 AUTH_SECRET}"
: "${AUTH_URL:?请设置 AUTH_URL (如 https://chat.yuban.icu)}"
# 缺失时运行期 /api/keys 会 500(crypto.ts 直接 throw),提前拦截
: "${ENCRYPTION_KEY:?请设置 ENCRYPTION_KEY (生成: openssl rand -base64 32)}"

export POSTGRES_USER="${POSTGRES_USER:-admin}"
export POSTGRES_DB="${POSTGRES_DB:-aichatt}"
export COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
export COMPOSE_PROJECT_NAME=aichatt

# VPS 上 docker daemon 关闭了 BuildKit 时 compose 构建会报
# "open /var/lib/docker/buildkit/executor: no such file or directory",
# 这里显式关掉 BuildKit 走经典构建器
export DOCKER_BUILDKIT=0
export COMPOSE_DOCKER_CLI_BUILD=0

DC=(docker compose --env-file "$ENV_FILE")

# 数据库迁移: standalone 运行时镜像里没有 prisma CLI(.bin 未随 standalone 打包),
# 容器内 npx 会拉新版 prisma 且装不全 config 依赖。改用一次性容器跑:
# node:20 + 临时安装与项目同版本的 prisma, 走 internal 网络直连 postgres。
# 版本号需与 package.json 的 prisma 依赖保持一致。
run_migrations() {
  log "执行数据库迁移..."
  (
    set -a; . "$ENV_FILE"; set +a
    docker run --rm --network aichatt_internal \
      -e DATABASE_URL="postgresql://${POSTGRES_USER:-admin}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-aichatt}?schema=public" \
      -v "$PROJECT_ROOT/prisma:/app/prisma" \
      -v "$PROJECT_ROOT/prisma.config.ts:/app/prisma.config.ts" \
      -w /app \
      node:20-bookworm-slim \
      sh -c "npm install --no-save --silent dotenv@17 prisma@7.9.1 >/dev/null 2>&1 && ./node_modules/.bin/prisma migrate deploy"
  )
}

# ---------- 检查 ----------
ensure_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "Docker 已就绪"
    return
  fi
  warn "未检测到 docker,开始安装..."
  if [ "$(id -u)" -ne 0 ]; then
    err "安装 docker 需要 root,请用 sudo 运行"
    exit 1
  fi
  curl -fsSL https://get.docker.com | sh
  ok "Docker 安装完成"
}

ensure_dns() {
  local domain="$1"
  log "检查 $domain 是否解析到本机..."
  local resolved
  resolved="$(getent hosts "$domain" 2>/dev/null | awk '{print $1}' | head -1 || true)"
  if [ -z "$resolved" ]; then
    err "$domain 无 DNS 记录,请先在域名服务商加 A 记录指向本机 IP"
    exit 1
  fi
  local my_ip
  my_ip="$(curl -fs https://api.ipify.org 2>/dev/null || curl -fs https://ifconfig.me 2>/dev/null || echo unknown)"
  if [ "$resolved" != "$my_ip" ] && [ "$my_ip" != "unknown" ]; then
    warn "DNS 解析($resolved)与本机公网 IP($my_ip)不一致,请确认"
  else
    ok "DNS 解析正确 -> $resolved"
  fi
}

print_bt_guide() {
  local domain="${AUTH_URL#https://}"
  domain="${domain#http://}"
  domain="${domain%/}"
  cat <<EOF

${YELLOW}==== 宝塔侧还需两步(只需一次) ====${NC}
1) 宝塔面板 -> 网站 -> 添加站点:
   域名: $domain
   根目录: 任意(反代用不上,如 /www/wwwroot/$domain)
   PHP: 纯静态
2) 站点设置 -> 反向代理:
   目标 URL: http://127.0.0.1:3001
   发送域名: \$host
   (高级功能里可开 WebSocket 支持,流式输出需要)
3) 站点设置 -> SSL -> Let's Encrypt 申请证书并开启强制 HTTPS
完成后访问: $AUTH_URL
EOF
}

# ---------- 命令 ----------
cmd_init() {
  log "==== 首次部署 ===="
  ensure_docker
  ensure_dns "${AUTH_URL#https://}"
  ensure_dns "${AUTH_URL#https://}" >/dev/null 2>&1 || true

  cd "$SCRIPT_DIR"

  log "构建并启动 app + postgres(首次构建在 2 核机器约 15-25 分钟)..."
  "${DC[@]}" up -d --build

  run_migrations

  ok "部署完成"
  "${DC[@]}" ps
  print_bt_guide
}

cmd_up() {
  cd "$SCRIPT_DIR"
  log "重新构建并启动..."
  "${DC[@]}" up -d --build
  run_migrations
  ok "更新完成"
  "${DC[@]}" ps
}

cmd_down() {
  cd "$SCRIPT_DIR"
  log "停止所有服务..."
  "${DC[@]}" down
  ok "已停止"
}

cmd_logs() {
  cd "$SCRIPT_DIR"
  "${DC[@]}" logs -f --tail 100 "${@:-}"
}

cmd_backup() {
  cd "$SCRIPT_DIR"
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  local out="$SCRIPT_DIR/backups/aichatt-$stamp.dump"
  mkdir -p "$SCRIPT_DIR/backups"
  log "导出 Postgres -> $out"
  "${DC[@]}" exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "$out"
  ok "备份完成: $out"
}

cmd_update() {
  cd "$PROJECT_ROOT"
  log "拉取最新代码..."
  git fetch origin
  git reset --hard origin/main
  chmod +x "$SCRIPT_DIR/deploy.sh" 2>/dev/null || true
  log "重新部署..."
  cmd_up
}

cmd_restart() {
  cd "$SCRIPT_DIR"
  local svc="${1:-app}"
  "${DC[@]}" restart "$svc"
}

cmd_shell() {
  cd "$SCRIPT_DIR"
  local svc="${1:-app}"
  "${DC[@]}" exec "$svc" /bin/sh
}

cmd_ps() {
  cd "$SCRIPT_DIR"
  "${DC[@]}" ps
}

# ---------- 入口 ----------
chmod +x "$0" 2>/dev/null || true

CMD="${1:-}"
shift || true
case "$CMD" in
  init)   cmd_init "$@" ;;
  up)     cmd_up "$@" ;;
  down)   cmd_down "$@" ;;
  logs)   cmd_logs "$@" ;;
  backup) cmd_backup "$@" ;;
  update) cmd_update "$@" ;;
  restart) cmd_restart "$@" ;;
  shell)  cmd_shell "$@" ;;
  ps)     cmd_ps "$@" ;;
  *)
    echo "用法: $0 {init|up|down|logs|backup|update|restart|shell|ps}"
    exit 1
    ;;
esac
