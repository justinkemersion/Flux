#!/usr/bin/env bash
# Open SSH forwards for local @flux/gateway dev against a Hetzner-style VPS.
# Usage: bash packages/gateway/bin/hetzner-tunnel.sh
# Override: SSH_TUNNEL_HOST, LOCAL_PG, LOCAL_PGRST, LOCAL_REDIS, REMOTE_* ports
set -euo pipefail

SSH_TUNNEL_HOST="${SSH_TUNNEL_HOST:-178.104.205.138}"
SSH_USER="${SSH_TUNNEL_USER:-root}"

LOCAL_PG="${LOCAL_PG_PORT:-15432}"
LOCAL_PGRST="${LOCAL_PGRST_PORT:-13001}"
LOCAL_REDIS="${LOCAL_REDIS_PORT:-16379}"

REMOTE_PG="${REMOTE_PG_PORT:-5432}"
REMOTE_PGRST="${REMOTE_PGRST_PORT:-3001}"
REMOTE_REDIS="${REMOTE_REDIS_PORT:-6379}"

echo "Forwarding (local -> remote on ${SSH_USER}@${SSH_TUNNEL_HOST}):"
echo "  127.0.0.1:${LOCAL_PG}  -> 127.0.0.1:${REMOTE_PG}"
echo "  127.0.0.1:${LOCAL_PGRST} -> 127.0.0.1:${REMOTE_PGRST}"
echo "  127.0.0.1:${LOCAL_REDIS} -> 127.0.0.1:${REMOTE_REDIS}"
echo ""
echo "Leave this running. In packages/gateway/.env use:"
echo "  FLUX_SYSTEM_DATABASE_URL=postgresql://USER:PASS@127.0.0.1:${LOCAL_PG}/postgres"
echo "  FLUX_POSTGREST_POOL_URL=http://127.0.0.1:${LOCAL_PGRST}"
echo "  REDIS_URL=redis://127.0.0.1:${LOCAL_REDIS}"
echo ""

exec ssh -N \
  -L "127.0.0.1:${LOCAL_PG}:127.0.0.1:${REMOTE_PG}" \
  -L "127.0.0.1:${LOCAL_PGRST}:127.0.0.1:${REMOTE_PGRST}" \
  -L "127.0.0.1:${LOCAL_REDIS}:127.0.0.1:${REMOTE_REDIS}" \
  "${SSH_USER}@${SSH_TUNNEL_HOST}"
