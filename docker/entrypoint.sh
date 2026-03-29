#!/bin/sh
set -e

WEBROOT="/usr/share/nginx/html/reads"
APP="/app"

mkdir -p "$WEBROOT"

# ── Sync app files to nginx webroot ────────────────────────────
sync_to_webroot() {
  cp -f "$APP/index.html" "$APP/404.html" "$APP/favicon.svg" "$WEBROOT/"
  cp -rf "$APP/assets" "$WEBROOT/"
  [ -d "$APP/_generated" ] && cp -rf "$APP/_generated" "$WEBROOT/" || true
}

# ── Generate manifest + sync ───────────────────────────────────
regenerate() {
  echo "[entrypoint] Generating manifest…"
  cd "$APP" && bun generate-manifest.js content .
  cp -f "$APP/content-manifest.json" "$WEBROOT/"
  cp -rf "$APP/content" "$WEBROOT/"
  [ -d "$APP/_generated" ] && cp -rf "$APP/_generated" "$WEBROOT/" || true
  echo "[entrypoint] Ready"
}

# ── Initial setup ──────────────────────────────────────────────
sync_to_webroot
regenerate

# ── Start nginx in background ──────────────────────────────────
nginx -g "daemon off;" &
NGINX_PID=$!

# ── Watch content/ for changes (debounced) ─────────────────────
echo "[entrypoint] Watching content/ for changes…"
LAST_RUN=0
inotifywait -m -r -e modify,create,delete,move "$APP/content" |
  while read -r dir event file; do
    NOW=$(date +%s)
    if [ $((NOW - LAST_RUN)) -lt 2 ]; then continue; fi
    LAST_RUN=$NOW
    echo "[watch] $event: $dir$file"
    regenerate
  done &

wait $NGINX_PID
