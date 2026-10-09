# Operator reference: gateway health and readiness

**Audience:** Flux operators.  
**Status:** operator-only. This is the canonical contract for `@flux/gateway` process checks.  
**Source of truth:** `packages/gateway/src/app.ts` (`GET /health`, `GET /health/deep`) and `packages/gateway/src/db.ts` (`pingDb`).  
**Related:** [Deploy triage](./OPERATOR-DEPLOY-TRIAGE.md) · [README § Production deployment](../README.md#production-deployment) · [Control-plane provenance](./CONTROL-PLANE-PROVENANCE.md)

`docs/OPERATIONS.md` is the Hetzner namespaced-project rebuild runbook. It does not define these endpoints.

## What each route means

Both routes are registered before tenant resolution, the static-asset absorber, and the proxy. They do not require `Authorization`. A project JWT is still required on every other tenant API route.

| | `GET /health` | `GET /health/deep` |
|--|---------------|--------------------|
| Role | **Liveness.** The Node process is accepting HTTP. | **Readiness.** The gateway can reach the flux-system catalog database. |
| I/O | None. No Postgres, no Redis, no PostgREST. | `SELECT 1` on `FLUX_SYSTEM_DATABASE_URL` (pool connect timeout 2s). If `REDIS_URL` is set, a Redis `PING` (connect, socket, and command timeouts 400ms). |
| HTTP 200 body | `{"status":"ok"}` | `{"ok":true,"db":"up","redis":"up"\|"down"\|null}` |
| HTTP 503 body | Does not return 503 for a live process. | `{"ok":false,"db":"down","redis":"up"\|"down"\|null}` when `SELECT 1` throws (refused, timeout, auth failure). |
| What does not affect the status | Dependencies. A listening process returns 200. | Redis. `ok` and the status code follow the system database only. |

`redis` is `null` when `REDIS_URL` is unset (Redis is optional; rate-limit and hostname cache fail open). `"down"` means a client exists and `PING` failed. That still returns HTTP 200 when `db` is `"up"`.

These routes do **not** check PostgREST, PgBouncer, tenant schemas, JWT verification, Traefik, or public DNS. A green `/health/deep` means the catalog database answered `SELECT 1`.

The shipped `packages/gateway/docker-compose.yml` publishes port `4000` and sets `restart: unless-stopped`. It does not define a Docker `HEALTHCHECK`. Use the curls below (or the deploy script) rather than `State.Health`.

## Host checks

On the Docker host, after the gateway container is up (`GATEWAY_HOST_PORT` defaults to `4000`):

```bash
curl -fsS http://127.0.0.1:4000/health && echo
curl -fsS http://127.0.0.1:4000/health/deep && echo
```

`-f` fails the command on HTTP 503, which is the readiness failure. Read the JSON when you need to see whether Redis is down while the database is up:

```bash
curl -sS http://127.0.0.1:4000/health/deep
```

## Deploy-script gates

`bin/deploy-gateway.sh` is the enforcing script. `bin/restart-gateway.sh` calls it with `FLUX_DEPLOY_RESTART_ONLY=1` (no image build, no canary). `bin/deploy-all.sh` and `bin/restart-all.sh` print the same two curls after their stages; they do not run a second gate.

| Check | When | On failure |
|-------|------|------------|
| `GET /health` → 200 | After the live container is running, retried for `FLUX_GATEWAY_HEALTH_WARMUP_SECS` (default 60) every `FLUX_GATEWAY_HEALTH_INTERVAL_SECS` (default 3) | Script exits non-zero |
| `GET /health/deep` → 200 | Pre-cutover canary on image build (same image and env, loopback only, no Traefik labels), one attempt after canary liveness. Skipped when `FLUX_DEPLOY_RESTART_ONLY=1` | Script exits non-zero; live container is left in place |
| `GET /health/deep` → 200 | After the live container is up, against `FLUX_GATEWAY_DEEP_URL` | **Warning only.** On an image deploy the canary already required readiness before cutover. A restart-only cycle has no canary, so a down system database is a warning after the container is already serving |
| Unauthenticated `GET /` with `Host: $FLUX_GATEWAY_CANARY_TENANT_HOST` → 401 | Canary, only when that host is set | Script exits non-zero. This is the inbound-auth contract, not a health route |

Shell overrides (read by the deploy script, not by the gateway process):

| Variable | Default | Meaning |
|----------|---------|---------|
| `FLUX_GATEWAY_HEALTH_URL` | `http://127.0.0.1:4000/health` | Liveness URL |
| `FLUX_GATEWAY_DEEP_URL` | `http://127.0.0.1:4000/health/deep` | Post-cutover readiness URL |
| `FLUX_GATEWAY_HEALTH_WARMUP_SECS` | `60` | Liveness retry window |
| `FLUX_GATEWAY_HEALTH_INTERVAL_SECS` | `3` | Seconds between liveness attempts |

`bin/ops-audit.sh` probes **liveness only** (`GET /health` from inside `flux-node-gateway`). A down system database does not fail that audit line.

`bin/deploy-v2-shared.sh` probes the **PostgREST pool root** (HTTP 200 or 401). That is a different process.

## Names that are not this contract

| Name | What it actually is |
|------|---------------------|
| `FLUX_SYSTEM_DATABASE_URL` | Gateway env. Catalog Postgres URL that `/health/deep` pings. Required for the process to start. |
| `REDIS_URL` | Gateway env. Optional. Unset → `redis: null` on `/health/deep`. |
| `FLUX_TENANT_PROBE_GATEWAY_URL` | Dashboard env (`docker/web/.env`), typically `http://flux-node-gateway:4000`. **v2_shared** fleet probes send the tenant API `Host` to this base. Dedicated probes use the tenant PostgREST container, then the public origin, on `/` (not `/health`). Archived projects are not probed. It does not call gateway `/health` or `/health/deep`. |
| `FLUX_TENANT_PROBE_SHALLOW` | Dashboard env. `1` / `true` / `yes` restores mesh success on HTTP 401 without a Bearer token. Default fleet probes mint a project JWT and require 2xx. |
| `GET /api/health` on `flux-web` | Control-plane liveness plus build provenance (`bin/deploy-web.sh`). There is no `/api/health/deep`. See [Control-plane provenance](./CONTROL-PLANE-PROVENANCE.md). |
| `FLUX_WEB_HEALTH_WARMUP_SECS` | Dashboard canary warmup. Unrelated to `FLUX_GATEWAY_HEALTH_WARMUP_SECS`. |

Load-test preflight (`perf/k6/run-matrix.sh`) uses readiness by default (`GET /health/deep`, fail on 503) and accepts `HEALTH_URL` for a liveness-only override.
