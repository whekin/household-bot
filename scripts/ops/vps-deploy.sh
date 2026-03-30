#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/household-bot}"
APP_DIR="${APP_DIR:-$DEPLOY_ROOT/app}"
ENV_DIR="${ENV_DIR:-$DEPLOY_ROOT/env}"
COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/deploy/vps/compose.yml}"

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Missing required file: $path" >&2
    exit 1
  fi
}

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required variable: $name" >&2
    exit 1
  fi
}

require_var BOT_IMAGE
require_var MINIAPP_IMAGE
require_file "$COMPOSE_FILE"
require_file "$ENV_DIR/bot.env"
require_file "$ENV_DIR/miniapp.env"
require_file "$ENV_DIR/caddy.env"

if [[ -n "${GHCR_USERNAME:-}" && -n "${GHCR_TOKEN:-}" ]]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
fi

export BOT_IMAGE
export MINIAPP_IMAGE
export ENV_DIR
export SCHEDULER_POLL_INTERVAL_MS="${SCHEDULER_POLL_INTERVAL_MS:-60000}"
export SCHEDULER_DUE_SCAN_LIMIT="${SCHEDULER_DUE_SCAN_LIMIT:-25}"

mkdir -p "$DEPLOY_ROOT"

docker compose -f "$COMPOSE_FILE" pull bot miniapp scheduler migrate caddy

docker compose -f "$COMPOSE_FILE" run --rm --no-deps migrate

docker compose -f "$COMPOSE_FILE" up -d --remove-orphans bot miniapp scheduler caddy

docker compose -f "$COMPOSE_FILE" ps
