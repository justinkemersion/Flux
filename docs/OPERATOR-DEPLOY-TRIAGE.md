# Operator reference: production deploy triage

**Audience:** Flux operators deploying or debugging production.  
**Status:** internal / operator-only  
**Deploy workflow:** [README.md § Production deployment](../README.md#production-deployment) · [Production hardening](./pages/guides/production-hardening.md)

Use this table when a deploy or health check fails. Symptom-first app-developer troubleshooting lives in [Troubleshooting](./pages/reference/troubleshooting.md).

## Failure triage quick map

| Symptom | Likely root cause | First check |
|--------|-------------------|-------------|
| `flux-node-gateway` restart loop | Runtime module resolution / env validation crash | `docker logs --since 5m flux-node-gateway` |
| Gateway `health` fails with reset | Process crashed before listener stabilized | Same logs + `docker inspect … State` |
| v2 provision fails in dashboard | `FLUX_SHARED_POSTGRES_URL` DNS/network mismatch | Verify `flux-web` attached to `flux-v2-shared` and URL host resolves |
| v2 mesh shows **Partial** / **Offline** but curl to tenant works | Public `https://` probe from `flux-web` fails (TLS / DNS) | Set `FLUX_TENANT_PROBE_GATEWAY_URL=http://flux-node-gateway:4000` in `docker/web/.env` and recreate `flux-web` |
| v2 mesh **Offline** after deep JWT probe deploy | Catalog `jwt_secret` null or JWT probe not 2xx | Run **Repair** on the project; optional `FLUX_TENANT_PROBE_SHALLOW=1` for legacy 401-only probes |
| `flux backup create` → `EACCES` on backup dir | Control plane runs as non-root `nextjs`; default backup dirs not writable | Redeploy `flux-web` with `docker/web/flux-web-entrypoint.sh` + compose volumes, or set `FLUX_BACKUPS_LOCAL_DIR` / `FLUX_BACKUPS_OFFSITE_DIR` to writable paths |
| `flux-web` logs `EACCES` on `/var/run/docker.sock` | Entrypoint dropped to `nextjs` without host `docker` GID | Rebuild `flux-web` with `setpriv` entrypoint + `FLUX_DOCKER_SUPPLEMENTARY_GID` / `DOCKER_GID` in `docker/web/docker-compose.yml` |
| PostgREST returns wrong schema data | Missing profile headers / hook misconfig | Gateway proxy headers + `PGRST_DB_PRE_REQUEST` / `flux_set_tenant_context` |
| Stale custom-domain routing | Redis cache not evicted | Domain CRUD/delete path calls `evictHostname(s)` |
| `flux push migrations/` fails: legacy global ledger has N row(s) | Shared Postgres still has pre–Pass 1B `flux.flux_migrations` (version-only PK) with rows | `./bin/migrate-pooled-ledger.sh --assign-legacy-to t_<shortId>_api` on the Flux host |

## Health gates (post-deploy)

```bash
curl -fsS http://127.0.0.1:4000/health && echo
curl -fsS http://127.0.0.1:4000/health/deep && echo
```

Optional: `pnpm --filter dashboard test` from the repo checkout on a dev machine or CI host.

## Ops audit

```bash
./bin/ops-audit.sh --remote              # weekly
./bin/ops-audit.sh --remote --deep --smoke   # monthly
```

See [README.md § Security and operations](../README.md#security-and-operations) for disk inventory and stale-container cleanup scripts.
