#!/usr/bin/env bash
# dev-up.sh — bring the whole local stack up after changing code:
#   1. docker compose infra (postgres, redis, rustfs, mailhog)
#   2. apps/builder/.env local overrides (local DB, http URLs)
#   3. pending database migrations onto the local DB
#   4. `turbo dev` for every app (worker, builder, gateways)
#   5. wait for the builder, then verify the demo login end-to-end
#
# Usage:
#   ./scripts/dev-up.sh            # start everything, tail the log path
#   ./scripts/dev-up.sh --install  # pnpm install first (after pulling code)
#   ./scripts/dev-up.sh --stop     # stop the dev processes it started
#
# Demo login (seeded): demo@example.com / Demo@1234 → http://localhost:3123
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOCAL_DB='postgresql://chatbotx:secretkey@localhost:25432/chatbotx?schema=public'
BUILDER_PORT=3123
LOG=/tmp/inboxos-dev.log
PIDFILE=/tmp/inboxos-dev.pid

DEMO_EMAIL=demo@example.com
DEMO_PASSWORD='Demo@1234'

log() { printf '\033[1;36m[dev-up]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[dev-up] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

stop_dev() {
  if [[ -f "$PIDFILE" ]]; then
    local pid pgid=""
    pid=$(cat "$PIDFILE")
    if kill -0 "$pid" 2>/dev/null; then
      pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
      if [[ -n "$pgid" ]]; then
        log "stopping turbo dev (pid $pid, pgid $pgid)"
        kill -TERM -- "-$pgid" 2>/dev/null || true
        sleep 2
        kill -KILL -- "-$pgid" 2>/dev/null || true
      fi
    fi
  fi
  # pkill the stragglers turbo spawned — scoped to this checkout so other
  # projects' tsx/next/turbo processes survive.
  pkill -f "$ROOT.*turbo.*dev" 2>/dev/null || true
  pkill -f "$ROOT.*next dev" 2>/dev/null || true
  pkill -f "$ROOT.*tsx --watch" 2>/dev/null || true
  rm -f "$PIDFILE"
}

if [[ "${1:-}" == "--stop" ]]; then
  stop_dev
  log "stopped. docker infra left running (docker compose stop to halt it too)."
  exit 0
fi

# ── 1. infra ────────────────────────────────────────────────────────────────
log "docker compose up (postgres redis filesystem mailhog)…"
docker compose up -d postgres redis filesystem mailhog >/dev/null
log "waiting for postgres…"
for i in $(seq 1 30); do
  docker exec chatbotx-postgres-1 pg_isready -U chatbotx -d chatbotx >/dev/null 2>&1 && break
  [[ $i == 30 ]] && die "postgres did not become ready"
  sleep 1
done

# ── 2. builder env overrides ────────────────────────────────────────────────
# Root .env targets the production deployment; apps/builder/.env is gitignored
# and loaded first by the dev script, so local values live there.
# Append-if-missing per key — never clobber vars the user added.
ensure_env() {
  local key="$1" value="$2" file="apps/builder/.env"
  touch "$file"
  grep -q "^${key}=" "$file" || { log "adding ${key} to ${file}"; echo "${key}=${value}" >> "$file"; }
}
ensure_env DATABASE_URL            "$LOCAL_DB"
ensure_env FORCE_PUBLIC_HTTPS      false
ensure_env NEXT_PUBLIC_BUILDER_URL "http://localhost:$BUILDER_PORT"
ensure_env BETTER_AUTH_URL         "http://localhost:$BUILDER_PORT"

# ── 3. optional install ─────────────────────────────────────────────────────
if [[ "${1:-}" == "--install" ]]; then
  log "pnpm install…"
  pnpm install
fi

# ── 4. migrations onto the LOCAL db ─────────────────────────────────────────
log "applying pending migrations to local db…"
DATABASE_URL="$LOCAL_DB" pnpm --filter @inboxos.io/database db:migrate 2>&1 | tail -3

# ── 5. start turbo dev ──────────────────────────────────────────────────────
stop_dev  # clean any previous run (also frees port 3123)
log "starting turbo dev → $LOG"
# setsid gives the dev tree its own process group; the inner bash writes its
# own pid — the session leader's — to the pidfile before exec'ing pnpm.
setsid bash -c "echo \$\$ >'$PIDFILE'; exec pnpm dev" </dev/null >"$LOG" 2>&1 &

log "waiting for builder on :$BUILDER_PORT (first compile can take a minute)…"
for i in $(seq 1 180); do
    # pidfile may not be written yet on the first iterations
    if [[ -f "$PIDFILE" ]] && ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      tail -20 "$LOG" >&2
      die "turbo dev exited — see $LOG"
    fi
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$BUILDER_PORT/auth/sign-in" 2>/dev/null || true)
  [[ "$code" == 200 ]] && break
  [[ $i == 180 ]] && { tail -20 "$LOG" >&2; die "builder never came up — see $LOG"; }
  sleep 1
done
log "builder is up: http://localhost:$BUILDER_PORT"

# ── 6. login smoke test ─────────────────────────────────────────────────────
log "verifying demo login…"
resp=$(curl -s -m 60 -X POST "http://localhost:$BUILDER_PORT/api/auth/sign-in/email" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$DEMO_EMAIL\",\"password\":\"$DEMO_PASSWORD\"}" \
  -c /tmp/dev-up-cookies.txt)
if grep -q '"token"' <<<"$resp"; then
  log "✅ login OK — session issued for $DEMO_EMAIL"
else
  log "⚠ login check failed: $resp (stack is up; auth may need a look)"
fi

cat <<EOF

  ┌─ stack ready ───────────────────────────────────────────┐
  │  builder   http://localhost:$BUILDER_PORT                     │
  │  login     $DEMO_EMAIL / $DEMO_PASSWORD              │
  │  logs      tail -f $LOG                        │
  │  mailhog   http://localhost:8025                       │
  │  stop      ./scripts/dev-up.sh --stop                  │
  └──────────────────────────────────────────────────────────┘
EOF
