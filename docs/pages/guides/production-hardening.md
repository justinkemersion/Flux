---
title: Production hardening
description: Operational and security practices for running Flux-backed apps in production.
section: guides
---

# Production hardening

Production is where implicit assumptions break: TLS trust, secret rotation, rate limits, and observability.

## What you will learn

- TLS and CA trust patterns for Node clients
- Why gateway and DB limits matter on shared clusters
- Pointers to internal ops docs

## The idea

- Prefer **`NODE_EXTRA_CA_CERTS`** (or system trust) over disabling TLS verification globally.
- On **v2**, internal probes should often target the **gateway** with correct `Host` headers—see [Gateway](/docs/architecture/gateway) and [Environment variables](/docs/reference/env-vars) (`FLUX_TENANT_PROBE_GATEWAY_URL`).
- Treat gateway signing keys like database superuser passwords: rotation plans, access logging, least privilege.

## How it works

Review:

- `docs/production-security-audit.md` — audit framing
- `docs/OPERATIONS.md` — operational checklist items relevant to your deployment

**Self-hosted operators — control plane:** **`flux migrate`** runs **`pg_dump` inside the dashboard/control-plane container** against the shared cluster. That image must include PostgreSQL **client** tools on **`PATH`** inside the process that handles **`/api/cli/v1/migrate`**; restarting an old container without rebuilding leaves **`pg_dump` missing** at runtime. App builders on **hosted** Flux cannot fix this in their own repo—see hosted vs self-hosted notes under [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate) troubleshooting.

### Backup storage and verification (self-hosted only)

Three environment variables shape where backups live and how `flux backup verify` is run. Hosted Flux manages these for you; on a self-hosted install the operator owns them:

- **`FLUX_BACKUPS_LOCAL_DIR`** — primary backup volume on the control plane host. Default `/srv/flux/backups`. Must be writable by the `flux-web` process (uid `1001` in the shipped image). Backups are stored as `<projectId>/<backupId>.dump`.
- **`FLUX_BACKUPS_OFFSITE_DIR`** — secondary directory the offsite replicator copies to. Default `/srv/flux/backups-offsite`. Today this is filesystem-only; future Backblaze B2 / S3-compatible backends will plug in here without changing the env-var contract.
- **`FLUX_BACKUP_VERIFY_POSTGRES_IMAGE`** — image used for the disposable Postgres container during `flux backup verify`. Default `postgres:17-alpine`. Override only if your tenant Postgres major version differs and you need to align them.

Both `FLUX_BACKUPS_*` paths must exist and be writable by the control-plane process before the first `flux backup create`. The shipped Docker compose mounts them as named volumes; if you run flux-web outside the canonical compose layout, `chown` the directories to uid `1001` or set the env vars to paths the process can already write to.

The user-facing trust contract (what backups guarantee, the three trust states) is engine-independent and lives in [Backups](/docs/concepts/backups). This section is purely about where bytes physically land on the operator's host.

## Example

For multi-region or multi-cluster, document **which** Postgres cluster holds a tenant before running destructive maintenance.

## Next steps

- [Threat model](/docs/security/threat-model)
- [Environment variables](/docs/reference/env-vars)
- [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate)
