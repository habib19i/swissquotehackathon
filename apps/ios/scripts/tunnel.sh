#!/bin/sh
# Gives the iPhone an https address for the services on this Mac: a Cloudflare quick tunnel to the
# Next.js server (port 3000), which forwards /svc/cosigner and /svc/recovery to the two services.
#
# While it runs, ANYONE with the printed URL can reach the (Mock) services. Stop it with Ctrl+C.
#
# It writes the tunnel's name into the root .env (the recovery key's RP_ID and allowed origins), so restart
# `pnpm dev` after it prints the URL. A new tunnel has a new name: recovery keys added under an earlier name
# do not work under a new one, so keep one tunnel running for a whole demo.
set -e
cd "$(dirname "$0")/../../.."
LOG=$(mktemp -t sqw-tunnel)
cloudflared tunnel --no-autoupdate --url http://localhost:3000 >"$LOG" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; rm -f "$LOG"' EXIT INT TERM
for _ in $(seq 1 60); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1)
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || { echo "No tunnel URL after 60 s:"; cat "$LOG"; exit 1; }
HOST=${URL#https://}

set_env() { # key value: replaces the key's line in .env, or adds it
  grep -v "^$1=" .env > .env.tmp 2>/dev/null || true
  echo "$1=$2" >> .env.tmp
  mv .env.tmp .env
}
set_env RP_ID "$HOST"
set_env APP_ORIGINS "$URL,http://localhost:3000"
set_env DEV_ORIGINS "$HOST"

echo "Tunnel: $URL"
echo "1. Restart pnpm dev (it reads .env at start)."
echo "2. In the app on the iPhone: Hackathon prototype > Swissquote services > $URL > Use this address."
wait $PID
