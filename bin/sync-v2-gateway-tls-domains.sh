#!/bin/bash
# Stamp Traefik ACME tls.domains[N].main labels for every v2_shared API host on
# flux-node-gateway. TLS-ALPN (myresolver) cannot issue wildcard *.domain certs;
# explicit per-host domains are required (see packages/gateway/docker-compose.yml).
#
# Usage (from repo root):
#   ./bin/sync-v2-gateway-tls-domains.sh
#   FLUX_DEPLOY_RESTART_ONLY=1 ./bin/deploy-gateway.sh   # apply labels
#
# Env:
#   FLUX_DOMAIN                 — default vsl-base.com
#   FLUX_SYSTEM_DB_CONTAINER    — default flux-5y57e70-flux-system-db
#   FLUX_GATEWAY_COMPOSE_FILE   — default packages/gateway/docker-compose.yml
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

DOMAIN="${FLUX_DOMAIN:-vsl-base.com}"
DB_CONTAINER="${FLUX_SYSTEM_DB_CONTAINER:-flux-5y57e70-flux-system-db}"
COMPOSE_FILE="${FLUX_GATEWAY_COMPOSE_FILE:-packages/gateway/docker-compose.yml}"

if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  echo "ERROR: system DB container not found: $DB_CONTAINER" >&2
  exit 1
fi

ROWS="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAc \
  "SELECT slug || chr(9) || hash FROM projects WHERE mode = 'v2_shared' ORDER BY slug;")"

if [[ -z "$ROWS" ]]; then
  echo "ERROR: no v2_shared projects in catalog" >&2
  exit 1
fi

python3 - "$COMPOSE_FILE" "$DOMAIN" "$ROWS" <<'PY'
import sys
from pathlib import Path

compose_path = Path(sys.argv[1])
domain = sys.argv[2]
raw = sys.argv[3]
rows = [line for line in raw.splitlines() if line.strip()]

hosts: list[str] = []
for row in rows:
    slug, hash_ = row.split("\t", 1)
    hosts.append(f"api--{slug}--{hash_}.{domain}")

marker_start = "      traefik.http.routers.flux-v2-shared-gateway.tls.certresolver: myresolver\n"
marker_end = "      traefik.http.services.flux-v2-shared-gateway.loadbalancer.server.port:"

text = compose_path.read_text()
start = text.find(marker_start)
end = text.find(marker_end)
if start == -1 or end == -1 or end <= start:
    raise SystemExit("compose markers not found; aborting")

domain_lines = "".join(
    f"      traefik.http.routers.flux-v2-shared-gateway.tls.domains[{i}].main: {host}\n"
    for i, host in enumerate(hosts)
)

new_text = text[: start + len(marker_start)] + domain_lines + text[end:]
compose_path.write_text(new_text)
print(f"stamped {len(hosts)} tls.domains entries into {compose_path}")
for host in hosts:
    print(f"  - {host}")
PY

echo "Next: FLUX_DEPLOY_RESTART_ONLY=1 ./bin/deploy-gateway.sh"
