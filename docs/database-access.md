# Private Database Access (developer index)

**Canonical user guide** (rendered on the dashboard): [`docs/pages/guides/database-access.md`](pages/guides/database-access.md) → **https://flux.vsl-base.com/docs/guides/database-access**

**Operator deep dive** (repo root): [README § Private database access](../README.md#private-database-access)

## What shipped

| Pass | Scope |
|------|--------|
| **Pass 1** | `DatabaseAccessPlan` resolver, `GET /api/cli/v1/projects/:hash/db-access`, `flux db access-plan` / `gui-config` / `flux db tunnel` (v1), dashboard Private Database Access panel, docs skeleton |
| **Pass 2** | v2 temporary credential tables + API, engine-v2 role SQL, v2 tunnel/shell/dump, v2 restore refusal, audit events, smoke script |
| **Password UX** | `flux db password`, `flux project credentials --field postgres.*`, structured v1 credentials output, tunnel GUI copy points at password command |

## Key paths (code)

| Area | Location |
|------|----------|
| Access plan types | `packages/core/src/projects/database-access.ts` |
| Role naming | `packages/core/src/projects/db-access-roles.ts` |
| v2 temp role SQL | `packages/engine-v2/src/db-access.ts` |
| CLI commands | `packages/cli/src/commands/db-access.ts`, `register-cli/db.ts` |
| Tunnel / psql / pg_dump | `packages/cli/src/db-access/connect.ts`, `ssh-tunnel.ts` |
| GUI copy / tests | `packages/cli/src/db-access/format.ts` |
| Postgres field parsing | `packages/cli/src/postgres-connection-fields.ts` |
| API routes | `apps/dashboard/app/api/cli/v1/projects/[hash]/db-access/` |
| Temp credential broker | `apps/dashboard/src/lib/project-db-temp-credentials.ts` |
| Dashboard panel | `apps/dashboard/src/components/projects/project-db-access-panel.tsx` |
| Smoke | `bin/db-access-smoke.sh` |

## Server env (`docker/web/.env`)

```bash
FLUX_DB_TUNNEL_SSH_HOST=178.104.205.138   # bastion for ssh -L
# FLUX_DB_TUNNEL_SSH_USER=root
# FLUX_DB_TUNNEL_SSH_PORT=22
# FLUX_DB_ACCESS_ALLOW_READWRITE=1          # optional v2 read/write temp roles
```

Sync: `./bin/sync-env-remote.sh --apply` or `./bin/launch-web.sh --sync-env-apply`.

## Quick commands

```bash
# v1 Beekeeper/DBeaver
flux db tunnel yeastcoast --hash ffca33f          # terminal 1 — keeps tunnel open
flux db password yeastcoast --hash ffca33f      # terminal 2 — paste password

# v2 pooled — Beekeeper: use Database postgres, not the temp username
flux db tunnel flux-app-foundry --hash 5774112
# GUI block: Database: postgres · Tenant schema: t_…_api · SSH tunnel (GUI): off

# Paste-friendly alternative (v1 only)
flux project credentials yeastcoast --hash ffca33f --field postgres.password

# Operator smoke (see README for full env)
./bin/db-access-smoke.sh
```

## Security invariants

- Postgres is not bound to the public internet.
- **`flux db tunnel`** does not print v1 long-lived passwords (use **`flux db password`**).
- v2 never exposes pooled admin credentials; temp roles are schema-scoped with grants + RLS.
- Temp credential passwords are shown once, not stored in flux-system plaintext.
- v2 **`flux db dump`** via temp readonly roles may require **`--schema-only`** (RLS blocks data COPY); full export → **`flux backup create`**.
