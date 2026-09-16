#!/usr/bin/env bash
# =========================================================
# aichatt VPS ??????
# ??? Ubuntu 22.04+ / Debian 12+
#
# ??:
#   1) cd deploy && cp .env.production.example .env.production
#   2) ?? .env.production (?? PASSWORD/SECRET/DOMAIN/EMAIL)
#   3) ./deploy.sh init   # ??: ? docker + ???? + ??????
#   4) ./deploy.sh up     # ??: ???????
#   5) ./deploy.sh down   # ??????
#   6) ./deploy.sh logs   # ???
#   7) ./deploy.sh backup # ?????
#   8) ./deploy.sh update # ??? + ????
# =========================================================
set -euo pipefail

# ---------- ?? ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { printf "${BLUE}[$(date +%H:%M:%S)]${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[!]${NC} %s\n" "$*"; }
err()  { printf "${RED}[ERR]${NC} %s\n" "$*" 1>&2; }

# ---------- ????? ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.production"

if [ ! -f "$ENV_FILE" ]; then
  err "??? $ENV_FILE"
  err "?: cp $SCRIPT_DIR/.env.production.example $ENV_FILE ???"
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

: "${POSTGRES_PASSWORD:???? POSTGRES_PASSWORD}"
: "${AUTH_SECRET:???? AUTH_SECRET}"
: "${AUTH_URL:???? AUTH_URL}"
: "${DOMAIN:???? DOMAIN}"
: "${CERTBOT_EMAIL:???? CERTBOT_EMAIL}"

export POSTGRES_USER="${POSTGRES_USER:-admin}"
export POSTGRES_DB="${POSTGRES_DB:-aichatt}"
export COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
export COMPOSE_PROJECT_NAME=aichatt

# VPS ??????,daemon.json ??? BuildKit,
# ? docker compose ???????,??
# "open /var/lib/docker/buildkit/executor: no such file or directory"?
# ????? builder(???)?
export DOCKER_BUILDKIT=0
export COMPOSE_DOCKER_CLI_BUILD=0

# docker compose ???? .env;???????? .env.production,????
DC=(docker compose --env-file "$ENV_FILE")

# ---------- ???? ----------
ensure_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "Docker ???"
    return
  fi
  warn "???? docker,??????..."
  if [ "$(id -u)" -ne 0 ]; then
    err "?? root ??? docker,?? sudo ??"
    exit 1
  fi
  curl -fsSL https://get.docker.com | sh
  ok "Docker ????"
}

ensure_dns() {
  log "???? $DOMAIN ???????..."
  local resolved
  resolved="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)"
  if [ -z "$resolved" ]; then
    err "$DOMAIN ?? DNS ??,?????? A ?????? IP"
    exit 1
  fi
  local my_ip
  my_ip="$(curl -fs https://api.ipify.org 2>/dev/null || curl -fs https://ifconfig.me 2>/dev/null || echo unknown)"
  if [ "$resolved" != "$my_ip" ] && [ "$my_ip" != "unknown" ]; then
    warn "DNS ??($resolved)????? IP($my_ip)???"
    warn "???? DNS,?????????;????..."
  else
    ok "DNS ???? -> $resolved"
  fi
}

apply_https_config() {
  local tmpl="$SCRIPT_DIR/nginx/conf.d/app.conf.https.tmpl"
  local out="$SCRIPT_DIR/nginx/conf.d/app.conf"
  if [ ! -f "$tmpl" ]; then
    err "??? HTTPS ??: $tmpl"
    exit 1
  fi
  sed "s|__DOMAIN__|$DOMAIN|g" "$tmpl" > "$out"
  ok "HTTPS ????? $out"
}

apply_uploads_dir() {
  warn "/uploads/ ??? Next.js ??,??? Nginx"
}

# ---------- ?? ----------
cmd_init() {
  log "==== ????? ===="
  ensure_docker
  ensure_dns

  cd "$SCRIPT_DIR"

  log "1) ?? nginx (HTTP only,???????)..."
  "${DC[@]}" up -d nginx

  log "2) ?? Let's Encrypt ??..."
  # ?? docker run ?? certbot,??? compose (compose run --rm + entrypoint ??)
  docker run --rm \
    -v aichatt_certbot_conf:/etc/letsencrypt \
    -v aichatt_certbot_www:/var/www/certbot:rw \
    certbot/certbot certonly \
      --webroot --webroot-path /var/www/certbot \
      --email "$CERTBOT_EMAIL" --agree-tos --no-eff-email \
      -d "$DOMAIN"

  log "3) ? HTTPS ??..."
  apply_https_config

  log "4) ??????..."
  "${DC[@]}" up -d --build

  log "5) ???????..."
  # ????? root ?(?? nextjs ????? HOME ? EACCES)
  "${DC[@]}" exec -T -u root app sh -c "cd /app && npx prisma migrate deploy"

  apply_uploads_dir

  log "6) ?? nginx..."
  "${DC[@]}" exec nginx nginx -s reload

  ok "????: ?? https://$DOMAIN"
}

cmd_up() {
  cd "$SCRIPT_DIR"
  apply_https_config
  log "?????????..."
  "${DC[@]}" up -d --build
  log "???????..."
  "${DC[@]}" exec -T -u root app sh -c "cd /app && npx prisma migrate deploy"
  "${DC[@]}" exec nginx nginx -s reload 2>/dev/null || true
  ok "?????"
  "${DC[@]}" ps
}

cmd_down() {
  cd "$SCRIPT_DIR"
  log "??????..."
  "${DC[@]}" down
  ok "???"
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
  log "?? Postgres -> $out"
  "${DC[@]}" exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "$out"
  ok "????: $out"
}

cmd_update() {
  cd "$PROJECT_ROOT"
  log "??????..."
  git fetch origin
  git reset --hard origin/main
  # ????????(Windows git ???)
  chmod +x "$SCRIPT_DIR/deploy.sh" 2>/dev/null || true
  log "????..."
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

# ---------- entrypoint ----------
# Auto chmod (Windows git ??? +x)
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
    echo "??: $0 {init|up|down|logs|backup|update|restart|shell|ps}"
    exit 1
    ;;
esac