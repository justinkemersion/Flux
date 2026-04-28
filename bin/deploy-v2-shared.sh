#!/bin/bash
# Rebuild and restart the Flux v2 shared data-plane stack.
# Run on the host where Docker runs after the repo is present at $REPO_ROOT.
#
#   FLUX_DEPLOY_GIT_SYNC=1         — run `git pull --ff-only` first.
#   FLUX_DEPLOY_PRUNE_BUILDER=1    — also run `docker builder prune -f`.
#   FLUX_V2_COMPOSE_FILE           — compose file override.
#   FLUX_V2_ENV_FILE               — env file to source (default: docker/v2-shared/.env).
#   FLUX_V2_POSTGRES_CONTAINER     — default: flux-postgres-v2
#   FLUX_V2_PGBOUNCER_CONTAINER    — default: flux-pgbouncer
#   FLUX_V2_POSTGREST_CONTAINER    — default: flux-postgrest-pool
#   FLUX_V2_PROBE_CONTAINER        — default: flux-node-gateway (network probe origin)
#   FLUX_V2_SKIP_POSTGREST_PROBE=1 — skip postgrest HTTP probe
#   FLUX_V2_SKIP_CLUSTER_BOOTSTRAP=1 — skip bootstrapSharedCluster (advanced: first-time only)
#
# Required env vars for compose interpolation:
#   SHARED_POSTGRES_PASSWORD
#   PGB_BACKEND_PASSWORD
#   PGRST_DB_PASSWORD
#   FLUX_GATEWAY_JWT_SECRET
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="${FLUX_V2_COMPOSE_FILE:-docker/v2-shared/docker-compose.yml}"
ENV_FILE="${FLUX_V2_ENV_FILE:-docker/v2-shared/.env}"
COMPOSE="docker compose -f ${COMPOSE_FILE}"
PG_CONTAINER="${FLUX_V2_POSTGRES_CONTAINER:-flux-postgres-v2}"
PGB_CONTAINER="${FLUX_V2_PGBOUNCER_CONTAINER:-flux-pgbouncer}"
PGRST_CONTAINER="${FLUX_V2_POSTGREST_CONTAINER:-flux-postgrest-pool}"
PROBE_CONTAINER="${FLUX_V2_PROBE_CONTAINER:-flux-node-gateway}"
# Internal URL used only for exec-from-container probes; not used from the host.
PGRST_INTERNAL_URL="${FLUX_V2_POSTGREST_URL:-http://flux-postgrest-pool:3000/}"

echo "--- v2 Shared Deploy: Initializing ---"
echo "  repo: $REPO_ROOT"
echo "  compose: $COMPOSE_FILE"
echo "  env: $ENV_FILE"

if [[ -f "$ENV_FILE" ]]; then
  # Export everything from env file so both this script and docker compose interpolation see it.
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "  WARN: env file not found at ${ENV_FILE}; using current shell environment only."
fi

for req in SHARED_POSTGRES_PASSWORD PGB_BACKEND_PASSWORD PGRST_DB_PASSWORD FLUX_GATEWAY_JWT_SECRET; do
  if [[ -z "${!req:-}" ]]; then
    echo "  ERROR: required environment variable is missing: $req" >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Weak-password guard — reject known placeholder / default values that should
# never appear in a real deployment.  Prevents accidental exposure when someone
# deploys without updating the .env template.
#
# Set FLUX_ALLOW_WEAK_PASSWORDS=1 ONLY for isolated local development; never
# set it on a server accessible from the internet.
# ---------------------------------------------------------------------------
if [[ "${FLUX_ALLOW_WEAK_PASSWORDS:-}" != "1" ]]; then
  _weak_re='^(postgres|password|secret|changeme|change_me|change-me|CHANGE_ME|CHANGE_ME_STRONG_DB_PASSWORD|CHANGE_ME_MIN_32_CHARS|default|test|1234|12345|123456)$'
  for _pw_var in SHARED_POSTGRES_PASSWORD PGB_BACKEND_PASSWORD PGRST_DB_PASSWORD FLUX_GATEWAY_JWT_SECRET; do
    _pw_val="${!_pw_var}"
    if [[ "$_pw_val" =~ $_weak_re ]]; then
      echo "  ERROR: ${_pw_var} is set to a known placeholder value (\"${_pw_val}\")." >&2
      echo "         Generate a strong secret before deploying." >&2
      echo "           openssl rand -hex 32   # for passwords" >&2
      echo "           openssl rand -base64 48 # for JWT secrets" >&2
      echo "         Set FLUX_ALLOW_WEAK_PASSWORDS=1 to bypass (local dev only)." >&2
      exit 1
    fi
  done
fi

if [[ "${FLUX_DEPLOY_GIT_SYNC:-}" == "1" ]]; then
  echo "--- v2 Shared Deploy: Git sync (ff-only) ---"
  if [[ ! -d "$REPO_ROOT/.git" ]]; then
    echo "  skip: not a git checkout"
  else
    git -C "$REPO_ROOT" pull --ff-only
  fi
fi

echo "--- v2 Shared Deploy: Validating compose ---"
$COMPOSE config >/dev/null

echo "--- v2 Shared Deploy: Building images ---"
$COMPOSE build --pull

echo "--- v2 Shared Deploy: Cycling services ---"
$COMPOSE up -d --remove-orphans

echo "--- v2 Shared Deploy: Pruning dangling images ---"
docker image prune -f

if [[ "${FLUX_DEPLOY_PRUNE_BUILDER:-}" == "1" ]]; then
  echo "--- v2 Shared Deploy: Pruning build cache (builder) ---"
  docker builder prune -f
else
  echo "  (Set FLUX_DEPLOY_PRUNE_BUILDER=1 to also prune docker build cache.)"
fi

echo "--- v2 Shared Deploy: Verifying containers ---"
for container in "$PG_CONTAINER" "$PGB_CONTAINER" "$PGRST_CONTAINER"; do
  running="$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || echo false)"
  if [[ "$running" != "true" ]]; then
    status="$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo missing)"
    echo "  ERROR: ${container} is not running (State.Running=${running} status=${status})" >&2
    docker ps -a --filter "name=^${container}\$" || true
    exit 1
  fi
  echo "  ${container}: running"
done

# ---------------------------------------------------------------------------
# Cluster bootstrap — installs the PostgREST pre-config and pre-request hooks
# (flux_postgrest_config, flux_set_tenant_context) into the shared cluster's
# public schema.  Uses CREATE OR REPLACE so it is safe to run on every deploy.
# Skip with FLUX_V2_SKIP_CLUSTER_BOOTSTRAP=1 only if you are certain the hooks
# already exist and the PostgREST containers are not being rebuilt from scratch.
# ---------------------------------------------------------------------------
if [[ "${FLUX_V2_SKIP_CLUSTER_BOOTSTRAP:-}" == "1" ]]; then
  echo "--- v2 Shared Deploy: Cluster bootstrap skipped (FLUX_V2_SKIP_CLUSTER_BOOTSTRAP=1) ---"
else
  echo "--- v2 Shared Deploy: Cluster bootstrap (PostgREST hooks) ---"
  # Derive the statement timeout (ms) — mirrors FLUX_V2_ROLE_STATEMENT_TIMEOUT_MS default.
  _stmt_timeout_ms="${FLUX_V2_ROLE_STATEMENT_TIMEOUT_MS:-15000}"
  _pg_user="${SHARED_POSTGRES_USER:-postgres}"
  _pg_db="${SHARED_POSTGRES_DB:-postgres}"
  # Execute idempotent (CREATE OR REPLACE) SQL inside the already-running postgres
  # container.  This avoids any dependency on a Node/TypeScript runtime on the host.
  if docker exec -i "$PG_CONTAINER" \
      psql -U "$_pg_user" -d "$_pg_db" -v ON_ERROR_STOP=1 -q <<BOOTSTRAP_SQL
CREATE OR REPLACE FUNCTION public.flux_postgrest_config()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS \$\$
  SELECT set_config(
    'pgrst.db_schemas',
    coalesce(
      (
        SELECT string_agg(nspname, ',' ORDER BY nspname)
        FROM   pg_catalog.pg_namespace
        WHERE  nspname ~ '^t_[0-9a-f]{12}_api\$'
      ),
      'public'
    ),
    true
  );
\$\$;

CREATE OR REPLACE FUNCTION public.flux_set_tenant_context()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS \$\$
DECLARE
  _claims  json;
  _role    text;
  _schema  text;
BEGIN
  BEGIN
    _claims := current_setting('request.jwt.claims', true)::json;
  EXCEPTION WHEN others THEN
    RETURN;
  END;

  _role := _claims->>'role';
  IF _role IS NULL OR _role NOT LIKE 't_%_role' THEN
    RETURN;
  END IF;

  _schema := substring(_role FROM '^t_[0-9a-f]{12}') || '_api';

  EXECUTE format('SET LOCAL search_path = %%I', _schema);
  EXECUTE format('SET LOCAL statement_timeout = %%L', '${_stmt_timeout_ms}ms');
END;
\$\$;
BOOTSTRAP_SQL
  then
    echo "  cluster bootstrap: OK"
  else
    echo "  WARN: cluster bootstrap SQL failed; PostgREST hooks may be stale." >&2
    echo "        Re-run the deploy or set FLUX_V2_SKIP_CLUSTER_BOOTSTRAP=1 to skip." >&2
  fi
fi

# ---------------------------------------------------------------------------
# PostgREST probe — exec from a container on flux-v2-shared so Docker DNS
# resolves flux-postgrest-pool.  The host cannot reach expose:-only containers.
# ---------------------------------------------------------------------------
if [[ "${FLUX_V2_SKIP_POSTGREST_PROBE:-}" == "1" ]]; then
  echo "--- v2 Shared Deploy: PostgREST probe skipped (FLUX_V2_SKIP_POSTGREST_PROBE=1) ---"
elif docker ps --format '{{.Names}}' | grep -qxF "${PROBE_CONTAINER}"; then
  echo "--- v2 Shared Deploy: PostgREST probe (from ${PROBE_CONTAINER}) ---"
  probe_status="$(
    docker exec "$PROBE_CONTAINER" sh -lc \
      'node -e "fetch(process.argv[1]).then((r)=>{process.stdout.write(String(r.status));}).catch(()=>process.exit(2));" "$1"' \
      _ "$PGRST_INTERNAL_URL" 2>/dev/null || true
  )"
  if [[ "$probe_status" == "200" || "$probe_status" == "401" ]]; then
    echo "  postgrest: OK (${PGRST_INTERNAL_URL} -> ${probe_status})"
  elif [[ -z "$probe_status" ]]; then
    echo "  WARN: postgrest probe failed from ${PROBE_CONTAINER}; no status returned."
    echo "        (container may lack Node/fetch support; set FLUX_V2_SKIP_POSTGREST_PROBE=1 to skip)"
  else
    echo "  WARN: postgrest probe returned HTTP ${probe_status} at ${PGRST_INTERNAL_URL}"
  fi
else
  # NOTE: flux-postgrest-pool uses expose: not ports:, so it is unreachable from
  # the host shell.  We skip silently rather than probing a Docker-internal hostname
  # that will always fail DNS resolution on the host.
  echo "  WARN: probe container ${PROBE_CONTAINER} not running; PostgREST probe skipped."
  echo "        Start ${PROBE_CONTAINER} or set FLUX_V2_SKIP_POSTGREST_PROBE=1 to suppress."
fi

echo ""
echo "--- v2 Shared Deploy: Operational ---"
echo "  logs postgres:  docker logs -f $PG_CONTAINER"
echo "  logs pgbouncer: docker logs -f $PGB_CONTAINER"
echo "  logs postgrest: docker logs -f $PGRST_CONTAINER"
