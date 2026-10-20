#!/usr/bin/env sh
# OMEGA one-click launcher for macOS and Linux (ADR-093).
# Starts the local data proxy on 127.0.0.1:8796, which also serves the Ops Room, THE CHAIN and NABD pages,
# prints a live status table for every free data source, then opens the Ops Room in the default browser.
# Paper only: nothing started here can place an order or move money.
set -eu
cd "$(dirname "$0")"
PORT="${OMEGA_PROXY_PORT:-8796}"
URL="http://127.0.0.1:${PORT}/omega-ops-room-v1/omega-ops-room.html"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is needed. Install it from https://nodejs.org/ and run this file again."
  exit 1
fi
MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 18 ]; then
  echo "Node.js $MAJOR is too old. Install Node.js 18 or newer from https://nodejs.org/."
  exit 1
fi

open_browser() {
  sleep 2
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
  else echo "Open this address in your browser: $URL"
  fi
}
open_browser &
echo "Starting OMEGA on $URL (Ctrl+C to stop)"
exec node scripts/omega-data-proxy.mjs
