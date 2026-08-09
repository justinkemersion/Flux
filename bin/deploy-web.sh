#!/bin/bash
# Rebuild and restart the Flux control plane (Next.js dashboard + embedded CLI build).
# Run on the host where Docker runs (e.g. Hetzner) after the repo is present at $REPO_ROOT.
#
#   FLUX_DEPLOY_GIT_SYNC=1    —  run `git pull --ff-only` in the repo first (convenience on a server).
#   FLUX_DEPLOY_PRUNE_BUILDER=1 —  also `docker builder prune -f` (frees more NVMe; next build is colder).
#   FLUX_DEPLOY_RESTART_ONLY=1 — skip image build and prune; `compose up --no-build` only
#                                (set by bin/restart-web.sh).
#   FLUX_DEPLOY_ALLOW_DIRTY=1  — build a dirty tree anyway (documented emergency only; the
#                                resulting artifact reports dirty provenance and `flux` refuses
#                                pooled production migrations against it).
#   FLUX_WEB_SKIP_CANARY=1     — skip the pre-cutover provenance canary (not recommended).
#   FLUX_WEB_CANARY_PORT       — loopback port for the candidate probe (default: 3099).
#
# Provenance: the control plane decides pooled-push SQL adaptation, so this script proves the
# container it routes was built from a known commit. The image build context excludes `.git`, so
# the commit is read here and passed as a build arg, then read back from the running candidate
# over HTTP before cutover. Image creation time and file mtimes are never used.
#
# Prerequisite: `docker/web/.env` exists, Traefik + external network `flux-network` (see repo docs).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE="docker compose -f docker/web/docker-compose.yml"
# Must match `container_name` in docker/web/docker-compose.yml
CONTAINER_NAME="flux-web"
GATEWAY_NAME="${FLUX_GATEWAY_CONTAINER_NAME:-flux-gateway}"
CHECK_HOST="${FLUX_DEPLOY_CHECK_HOST:-flux.vsl-base.com}"
CANARY_NAME="${FLUX_WEB_CANARY_NAME:-flux-web-canary}"
CANARY_PORT="${FLUX_WEB_CANARY_PORT:-3099}"
HEALTH_WARMUP_SECS="${FLUX_WEB_HEALTH_WARMUP_SECS:-90}"
HEALTH_INTERVAL_SECS="${FLUX_WEB_HEALTH_INTERVAL_SECS:-3}"

FLUX_WEB_TAG="Deploy"
[[ "${FLUX_DEPLOY_RESTART_ONLY:-}" == "1" ]] && FLUX_WEB_TAG="Restart"

echo "--- Flux ${FLUX_WEB_TAG}: Initializing ---"
echo "  repo: $REPO_ROOT"
if grep -Eq '^\s*FLUX_TENANT_PROBE_GATEWAY_URL=' "$REPO_ROOT/docker/web/.env" 2>/dev/null; then
  echo "  tenant_probe_gateway: configured"
else
  echo "  WARN: FLUX_TENANT_PROBE_GATEWAY_URL is not set in docker/web/.env"
  echo "        Set it to http://flux-node-gateway:4000 to reduce false Offline mesh status."
fi

# 1. Optional: synchronize with origin (skip locally if unset)
if [[ "${FLUX_DEPLOY_GIT_SYNC:-}" == "1" ]]; then
  echo "--- Flux ${FLUX_WEB_TAG}: Git sync (ff-only) ---"
  if [[ ! -d "$REPO_ROOT/.git" ]]; then
    echo "  skip: not a git checkout"
  else
    git -C "$REPO_ROOT" pull --ff-only
  fi
fi

# 1b. Determine expected provenance from the checkout that is about to be built.
#     Read before the build so the value cannot be derived from the artifact it validates.
EXPECTED_SHA=""
BUILD_DIRTY=""
if [[ "${FLUX_DEPLOY_RESTART_ONLY:-}" != "1" ]]; then
  echo "--- Flux ${FLUX_WEB_TAG}: Resolving source provenance ---"
  if [[ ! -d "$REPO_ROOT/.git" ]]; then
    echo "  ERROR: $REPO_ROOT is not a git checkout, so the deployed commit cannot be established." >&2
    echo "         Deploy from a git checkout; a control plane with unknown provenance is refused" >&2
    echo "         by \`flux\` for pooled production migrations." >&2
    exit 1
  fi
  EXPECTED_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)" ]]; then
    BUILD_DIRTY="1"
    if [[ "${FLUX_DEPLOY_ALLOW_DIRTY:-}" == "1" ]]; then
      echo "  WARN: FLUX_DEPLOY_ALLOW_DIRTY=1 — building a dirty tree at ${EXPECTED_SHA:0:12}."
      echo "        The artifact will report dirty provenance and \`flux\` will refuse pooled"
      echo "        production migrations against it."
    else
      echo "  ERROR: working tree has uncommitted tracked changes; refusing a production build." >&2
      echo "         No commit would describe the deployed control plane, so pooled migration" >&2
      echo "         readiness could not be established." >&2
      git -C "$REPO_ROOT" status --porcelain --untracked-files=no | sed 's/^/    /' >&2
      echo "         Commit or stash, or set FLUX_DEPLOY_ALLOW_DIRTY=1 as a documented exception." >&2
      exit 1
    fi
  else
    BUILD_DIRTY="0"
  fi
  export FLUX_BUILD_SOURCE_SHA="$EXPECTED_SHA"
  export FLUX_BUILD_DIRTY="$BUILD_DIRTY"
  export FLUX_BUILD_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "  expected sha: ${EXPECTED_SHA:0:12} (dirty=${BUILD_DIRTY})"
fi

# ---------------------------------------------------------------------------
# Candidate probe: prove the freshly built image serves AND reports the expected commit
# BEFORE it replaces the live one. `compose up -d` recreates in place, so verifying after
# cutover only measures how long an outage or a mystery build has already been live.
# The candidate runs the same image, isolated from the platform networks and the Docker
# socket, so it can neither be routed nor touch production state.
# ---------------------------------------------------------------------------
canary_cleanup() {
  docker rm -f "$CANARY_NAME" >/dev/null 2>&1 || true
}

web_candidate_probe() {
  if [[ "${FLUX_WEB_SKIP_CANARY:-}" == "1" ]]; then
    echo "  skip: FLUX_WEB_SKIP_CANARY=1 (deploying an unverified control plane)"
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "  ERROR: curl not found; cannot verify candidate provenance before cutover." >&2
    echo "         Install curl or set FLUX_WEB_SKIP_CANARY=1 to accept an unverified deploy." >&2
    exit 1
  fi

  local image
  image="$($COMPOSE config --images 2>/dev/null | head -1)"
  if [[ -z "$image" ]]; then
    echo "  ERROR: could not resolve the web image name from compose." >&2
    exit 1
  fi

  canary_cleanup
  trap canary_cleanup EXIT

  # The candidate must be inert. It gets no Traefik labels (never routed), no docker.sock,
  # and no flux-network, so it cannot reach the flux-system catalog or the shared cluster.
  # That matters: instrumentation.ts runs idempotent bootstrap DDL against the production
  # system database and starts the backup scheduler on its first tick. Isolated, that
  # initialisation fails and is caught, the schedulers never start, and the container does the
  # one thing it is here to do — report which commit it was built from.
  if ! docker run -d --name "$CANARY_NAME" \
      --network bridge \
      --env-file "$REPO_ROOT/docker/web/.env" \
      -e NODE_ENV=production \
      -e AUTH_TRUST_HOST=true \
      -p "127.0.0.1:${CANARY_PORT}:3000" \
      "$image" >/dev/null 2>&1; then
    echo "  ERROR: candidate container failed to start from ${image}." >&2
    exit 1
  fi

  local base="http://127.0.0.1:${CANARY_PORT}"
  local deadline=$((SECONDS + HEALTH_WARMUP_SECS)) code="000" attempt=0
  while [[ $SECONDS -lt $deadline ]]; do
    attempt=$((attempt + 1))
    code="$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 "${base}/api/health" 2>/dev/null || echo "000")"
    [[ "$code" == "200" ]] && break
    if [[ "$(docker inspect -f '{{.State.Status}}' "$CANARY_NAME" 2>/dev/null || echo missing)" == "exited" ]]; then
      break
    fi
    sleep "$HEALTH_INTERVAL_SECS"
  done

  if [[ "$code" != "200" ]]; then
    echo "  ERROR: candidate failed liveness at /api/health (last HTTP ${code}) — live route untouched." >&2
    docker logs --tail 40 "$CANARY_NAME" 2>&1 | sed 's/^/    /' >&2 || true
    exit 1
  fi
  echo "  candidate liveness: OK (attempt=${attempt})"

  # Identity: the running process must report the commit we just built from.
  local body runtime_sha runtime_status
  body="$(curl -sS --connect-timeout 5 "${base}/api/health" 2>/dev/null || echo '')"
  runtime_sha="$(printf '%s' "$body" | sed -n 's/.*"sourceSha":"\([0-9a-f]*\)".*/\1/p')"
  runtime_status="$(printf '%s' "$body" | sed -n 's/.*"provenanceStatus":"\([a-z_]*\)".*/\1/p')"

  if [[ -z "$runtime_sha" ]]; then
    echo "  ERROR: candidate did not report a source commit at /api/health." >&2
    echo "         Response: ${body:0:400}" >&2
    echo "         An unidentifiable control plane is refused; do not cut over." >&2
    exit 1
  fi
  if [[ "$runtime_sha" != "$EXPECTED_SHA" ]]; then
    echo "  ERROR: candidate reports ${runtime_sha:0:12} but this checkout is ${EXPECTED_SHA:0:12}." >&2
    echo "         The image does not correspond to the source being deployed — live route untouched." >&2
    exit 1
  fi
  echo "  candidate provenance: OK (sourceSha=${runtime_sha:0:12}, status=${runtime_status:-unknown})"

  if [[ "$runtime_status" != "established" ]]; then
    echo "  WARN: candidate provenance status is '${runtime_status:-unknown}', not 'established'."
    echo "        \`flux\` will refuse pooled production migrations against this build."
  fi

  canary_cleanup
  trap - EXIT
}

# 2–4. Build (unless restart-only), cycle, prune
if [[ "${FLUX_DEPLOY_RESTART_ONLY:-}" == "1" ]]; then
  echo "--- Flux ${FLUX_WEB_TAG}: Cycling container (no image build) ---"
  $COMPOSE up -d --remove-orphans --no-build
else
  echo "--- Flux ${FLUX_WEB_TAG}: Building control plane ($CONTAINER_NAME) ---"
  $COMPOSE build --pull

  echo "--- Flux ${FLUX_WEB_TAG}: Verifying candidate before cutover ---"
  web_candidate_probe

  # Immutable per-commit tag: identifies the running image and survives `image prune`.
  docker tag "flux-web:latest" "flux-web:${EXPECTED_SHA}" >/dev/null 2>&1 \
    && echo "  tagged: flux-web:${EXPECTED_SHA:0:12}"

  echo "--- Flux ${FLUX_WEB_TAG}: Cycling container ---"
  $COMPOSE up -d --remove-orphans

  echo "--- Flux ${FLUX_WEB_TAG}: Pruning dangling images ---"
  docker image prune -f

  if [[ "${FLUX_DEPLOY_PRUNE_BUILDER:-}" == "1" ]]; then
    echo "--- Flux ${FLUX_WEB_TAG}: Pruning build cache (builder) ---"
    docker builder prune -f
  else
    echo "  (Set FLUX_DEPLOY_PRUNE_BUILDER=1 to also prune docker build cache to save more disk.)"
  fi
fi

# 5. Health check
echo "--- Flux ${FLUX_WEB_TAG}: Verifying container ---"
sleep 5
RUNNING="$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || echo false)"
if [[ "$RUNNING" != "true" ]]; then
  STATUS="$(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo missing)"
  echo "  ERROR: $CONTAINER_NAME is not running (State.Running=$RUNNING status=$STATUS)" >&2
  docker ps -a --filter "name=^${CONTAINER_NAME}\$" || true
  exit 1
fi
echo "  $CONTAINER_NAME: running"
docker ps --filter "name=^${CONTAINER_NAME}\$" --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'

# 5b. Live provenance: the routed container must report the commit we deployed.
#     Checked through the container's own port so a stale Traefik route cannot mask a mismatch.
if [[ "${FLUX_DEPLOY_RESTART_ONLY:-}" != "1" ]] && command -v curl >/dev/null 2>&1; then
  echo "--- Flux ${FLUX_WEB_TAG}: Verifying live provenance ---"
  LIVE_BODY=""
  for _ in $(seq 1 20); do
    LIVE_BODY="$(docker exec "$CONTAINER_NAME" node -e '
      fetch("http://127.0.0.1:3000/api/health").then(r=>r.text()).then(t=>{process.stdout.write(t)}).catch(()=>process.exit(1))
    ' 2>/dev/null || echo '')"
    [[ -n "$LIVE_BODY" ]] && break
    sleep 3
  done
  LIVE_SHA="$(printf '%s' "$LIVE_BODY" | sed -n 's/.*"sourceSha":"\([0-9a-f]*\)".*/\1/p')"
  if [[ -z "$LIVE_SHA" ]]; then
    echo "  ERROR: live control plane did not report a source commit at /api/health." >&2
    echo "         Deployment is NOT verified. Investigate before running migrations." >&2
    exit 1
  fi
  if [[ "$LIVE_SHA" != "$EXPECTED_SHA" ]]; then
    echo "  ERROR: live control plane reports ${LIVE_SHA:0:12}, expected ${EXPECTED_SHA:0:12}." >&2
    echo "         Deployment is NOT verified. A previous container may still hold the route." >&2
    exit 1
  fi
  echo "  live provenance: OK (sourceSha=${LIVE_SHA:0:12})"
fi

# 6. Ingress / router verification (Traefik labels + network + Host probe)
echo "--- Flux ${FLUX_WEB_TAG}: Verifying gateway route ---"
if ! docker ps --format '{{.Names}}' | grep -qxF "${GATEWAY_NAME}"; then
  echo "  WARN: Gateway container '${GATEWAY_NAME}' is not running."
  echo "        Traefik must be up to route ${CHECK_HOST}."
else
  if docker inspect "$CONTAINER_NAME" --format '{{json .NetworkSettings.Networks}}' | grep -q "\"flux-network\""; then
    echo "  network: ${CONTAINER_NAME} attached to flux-network"
  else
    echo "  WARN: ${CONTAINER_NAME} is not attached to flux-network."
    echo "        Traefik cannot reach the dashboard service on docker provider."
  fi

  LABEL_RULE="$(docker inspect -f '{{ index .Config.Labels "traefik.http.routers.flux-web.rule" }}' "$CONTAINER_NAME" 2>/dev/null || true)"
  if [[ -n "${LABEL_RULE:-}" ]]; then
    echo "  router: flux-web label present"
  else
    echo "  WARN: Missing traefik router labels on ${CONTAINER_NAME}."
  fi

  if command -v curl >/dev/null 2>&1; then
    HTTP_CODE="$(curl -sS -o /dev/null -w "%{http_code}" -H "Host: ${CHECK_HOST}" "http://127.0.0.1/" || echo "000")"
    # 301/308: common HTTP→HTTPS at the edge; 302/307: temporary redirects; 200: direct hit.
    if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "301" || "$HTTP_CODE" == "302" || "$HTTP_CODE" == "307" || "$HTTP_CODE" == "308" ]]; then
      echo "  route: OK (http://127.0.0.1 Host=${CHECK_HOST} -> ${HTTP_CODE})"
    else
      echo "  WARN: Gateway route probe failed (http code ${HTTP_CODE}) for Host=${CHECK_HOST}."
      echo "        If this is 404 Service Not Found, Traefik has no matching router/service for this host."
      echo "        Check: docker logs ${GATEWAY_NAME} --since 3m"
      echo "               docker inspect ${CONTAINER_NAME} --format '{{json .Config.Labels}}' | jq"
    fi
  else
    echo "  WARN: curl not found; skipped local gateway probe."
  fi
fi

echo ""
echo "--- Flux ${FLUX_WEB_TAG}: Operational ---"
if [[ -n "$EXPECTED_SHA" ]]; then
  echo "  commit: ${EXPECTED_SHA:0:12} (verified at /api/health)"
  echo "  ready:  run \`flux doctor control-plane\` from the operator checkout before migrations"
fi
echo "  logs:  docker logs -f $CONTAINER_NAME"
echo "  check: docker inspect $CONTAINER_NAME --format '{{.State.Health.Status}}'   # if HEALTHCHECK is added"
