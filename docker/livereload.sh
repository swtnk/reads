#!/bin/sh
# Lightweight livereload server using SSE (Server-Sent Events).
# Watches /watch for file changes via inotifywait, then pushes
# a "reload" event to all connected browser tabs.
set -e

PORT="${LIVERELOAD_PORT:-35729}"
WATCH_DIR="${WATCH_DIR:-/watch}"
PIPE="/tmp/lr-pipe"

mkfifo "$PIPE" 2>/dev/null || true

# ── SSE endpoint served via netcat ──────────────────────────────
serve_sse() {
  while true; do
    {
      echo "HTTP/1.1 200 OK"
      echo "Content-Type: text/event-stream"
      echo "Cache-Control: no-cache"
      echo "Access-Control-Allow-Origin: *"
      echo "Connection: keep-alive"
      echo ""
      # Keep connection alive with heartbeats; push reload on file change
      while true; do
        if read -r line < "$PIPE" 2>/dev/null; then
          echo "event: reload"
          echo "data: $line"
          echo ""
        else
          echo ": heartbeat"
          echo ""
        fi
        sleep 1
      done
    } | nc -l -p "$PORT" -q 0 2>/dev/null || nc -l -p "$PORT" 2>/dev/null || true
  done
}

# ── File watcher ────────────────────────────────────────────────
watch_files() {
  echo "[livereload] Watching $WATCH_DIR on port $PORT"
  inotifywait -m -r -e modify,create,delete,move "$WATCH_DIR" 2>/dev/null |
    while read -r dir event file; do
      echo "[livereload] $event: $dir$file"
      echo "$dir$file" > "$PIPE" 2>/dev/null || true
    done
}

serve_sse &
watch_files
