#!/bin/bash
# Manual remediation for a stale relay tunnel -- run this by hand, it is
# NOT auto-scheduled (rotating the live E2B_RELAY_URL secret unattended,
# on a timer, with nobody watching is a bigger blast radius than this
# problem deserves -- see README.md "Known deviations").
#
# What this fixes: quick tunnels (cloudflared tunnel --url, no account)
# have no uptime guarantee and can silently stop routing while the local
# process keeps running -- confirmed live on 2026-08-08, a tunnel that had
# been up ~18h started returning Cloudflare edge error 1016 (origin
# unreachable) on every request. That surfaces in the pipeline as every
# smoke/capability run failing with "E2B relay /run failed: 530 error
# code: 1016", even though sanity/classify (which don't touch the relay)
# keep working fine -- that specific error string is the tell.
#
# Usage: bash relay/watchdog.sh
set -e
cd "$(dirname "$0")"

CLOUDFLARED="/c/Program Files (x86)/cloudflared/cloudflared.exe"
TUNNEL_LOG="/tmp/xapi_tunnel_current.log"

if ! curl -sf -m 5 http://localhost:8080/health > /dev/null 2>&1; then
  echo "local relay isn't responding -- start it first: ./keepalive.sh &"
  exit 1
fi

echo "restarting the quick tunnel..."
pkill -f "cloudflared.exe tunnel" 2>/dev/null || true
sleep 1
"$CLOUDFLARED" tunnel --url http://localhost:8080 > "$TUNNEL_LOG" 2>&1 &
disown
sleep 10

NEW_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1)
if [ -z "$NEW_URL" ]; then
  echo "could not read a new tunnel URL from $TUNNEL_LOG -- inspect it manually"
  exit 1
fi

if ! curl -sf -m 10 "$NEW_URL/health" > /dev/null 2>&1; then
  echo "new tunnel $NEW_URL did not pass its own health check -- try again"
  exit 1
fi

echo "new tunnel is live and healthy: $NEW_URL"
echo "now repin the secret (requires your own confirmation, not run automatically):"
echo "  cd .. && echo -n \"$NEW_URL\" | npx wrangler secret put E2B_RELAY_URL"
