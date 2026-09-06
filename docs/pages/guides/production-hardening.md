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
- **`FLUX_BACKUPS_OFFSITE_DIR`** — secondary directory the offsite replicator copies to when R2 is **disabled**. Default `/srv/flux/backups-offsite`. Useful for same-host replication during testing.
- **`FLUX_BACKUP_VERIFY_POSTGRES_IMAGE`** — image used for the disposable Postgres container during `flux backup verify`. Default `postgres:17-alpine`. Override only if your tenant Postgres major version differs and you need to align them.

#### Cloudflare R2 offsite replication (optional)

When `FLUX_R2_BACKUPS_ENABLED=true`, completed backups upload to R2 (S3-compatible) immediately after the local artifact is written. Object keys:

```txt
{FLUX_R2_BACKUP_PREFIX}/flux/v1/{projectHash}/{backupId}.dump   # v1 dedicated
{FLUX_R2_BACKUP_PREFIX}/flux/v2/{tenantId}/{backupId}.dump      # v2 shared (catalog project UUID)
```

Set these in `docker/web/.env` next to compose (see [`docker/web/.env.example`](../../../docker/web/.env.example)):

| Variable | Purpose |
|----------|---------|
| `FLUX_R2_BACKUPS_ENABLED` | `true` to enable R2 upload |
| `FLUX_R2_BACKUP_BUCKET` | Bucket name (e.g. `vsl-base-flux-backups`) |
| `FLUX_R2_BACKUP_PREFIX` | Key prefix (e.g. `prod`) |
| `FLUX_R2_ENDPOINT` | `https://<account_id>.r2.cloudflarestorage.com` |
| `FLUX_R2_REGION` | `auto` |
| `FLUX_R2_ACCESS_KEY_ID` / `FLUX_R2_SECRET_ACCESS_KEY` | R2 API token credentials (server env only) |
| `FLUX_R2_BACKUPS_STRICT` | Optional — when `true`, backup create fails if offsite upload fails |

**Trust model:** R2 is an offsite replication layer only. Destructive gates (`flux nuke`, dashboard delete, etc.) still require a **restore-verified local** backup — offsite upload alone does not satisfy the gate.

#### Platform minimum backup freshness (self-hosted)

Separate from the destructive gate, the hourly backup scheduler enforces a **platform minimum backup freshness** floor: the newest **restore-verified** backup should be within `FLUX_MIN_BACKUP_INTERVAL_DAYS` (default **7**). When a project is stale, the scheduler runs create → validate → restore-verify (up to `FLUX_MIN_BACKUP_MAX_PIPELINES_PER_TICK` projects per tick; default **1** for production safety).

| Variable | Default | Role |
|----------|---------|------|
| `FLUX_MIN_BACKUP_INTERVAL_DAYS` | `7` | Max age of newest restore-verified backup before scheduler queues a pipeline |
| `FLUX_MIN_BACKUP_RETENTION_COUNT` | `4` | Minimum restore-verified backups kept locally (older verified rows may be deleted) |
| `FLUX_MIN_BACKUP_RETENTION_DAYS` | `30` | Only delete verified backups older than this *and* beyond the count floor |
| `FLUX_MIN_BACKUP_MAX_PIPELINES_PER_TICK` | `1` | Cap full backup pipelines per scheduler tick (raise to `2`–`3` after observing CPU/disk) |
| `FLUX_MIN_BACKUP_BOOTSTRAP_MAX_PIPELINES` | `10` | On the scheduler's **first tick** (immediate on startup), run up to this many stale projects before falling back to the per-tick cap |
| `FLUX_MIN_BACKUP_EXCLUDE_SLUGS` | — | Extra comma-separated slugs (built-in: `flux-system`, `static`) |
| `FLUX_MIN_BACKUP_EXCLUDE_USER_IDS` | — | Extra user ids (demo user from `FLUX_DEMO_USER_ID` is merged automatically when set) |

Retention sweeps **restore-verified catalog rows only**; unverified complete backups are not counted toward the floor of four. When a verified row is removed, Flux also deletes its offsite replica (R2 object, or the filesystem copy under `FLUX_BACKUPS_OFFSITE_DIR`). A missing remote object is non-fatal — the sweep logs and continues. Objects uploaded before this behavior shipped may still need a one-time bucket cleanup. KEEP floors (`FLUX_MIN_BACKUP_RETENTION_COUNT` / `DAYS`) are unchanged.

Freshness is visible in the dashboard Database tools panel and CLI backup list/create responses. It does **not** add HTTP 412 blocks beyond the existing restore-verified destructive gate.

The CLI runs on your laptop but backup I/O executes inside `flux-web`; R2 credentials belong on the control-plane host/container, not in app repos.

Both `FLUX_BACKUPS_*` paths must exist and be writable by the control-plane process before the first `flux backup create`. The shipped Docker compose mounts them as named volumes; if you run flux-web outside the canonical compose layout, `chown` the directories to uid `1001` or set the env vars to paths the process can already write to.

The user-facing trust contract (what backups guarantee, the three trust states) is engine-independent and lives in [Backups](/docs/concepts/backups). This section is purely about where bytes physically land on the operator's host.

**Periodic audit (self-hosted):** from the repo on your laptop or the server checkout, run `bin/ops-audit.sh --remote` (SSH defaults match `bin/sync-env-remote.sh`). Add `--deep` for backup-catalog trust rows and **platform minimum backup freshness** (restore-verified age vs `FLUX_MIN_BACKUP_INTERVAL_DAYS`); add `--smoke` to GET each tenant API through `flux-node-gateway` (see `bin/ops-audit-smoke.projects.example`). The scheduler restore-verifies stale projects automatically; `--deep` still warns when the newest restore-verified backup is missing or overdue. Schema-only empty v2 tenants (zero user tables) can be restore-verified — they are not treated as `restore_failed` once the tenant schema and empty dump TOC match.

#### Email alerts for scheduler / ops failures (optional)

Production currently logs backup-scheduler failures; it does **not** send mail unless you opt in. Set these on the **control plane** (`docker/web/.env`, then recreate `flux-web`).

**Cloudflare Email Routing caveat:** `vsl-base.com` inbound mail uses [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/). That product is **receive-only** (MX → destination mailbox). It does **not** provide SMTP or an outbound API. Pointing `FLUX_SMTP_HOST` at Cloudflare will not deliver alerts. Use a send provider.

**Primary path — Resend HTTP API** (SMTP not required):

| Variable | Role |
|----------|------|
| `FLUX_ALERT_EMAIL_TO` | Recipient list (comma-separated). **Required to enable.** Production destination: `justin@vsl-base.com` |
| `FLUX_RESEND_API_KEY` | Resend API key (`re_…`). **Required for the primary path.** Create at [resend.com/api-keys](https://resend.com/api-keys) |
| `FLUX_ALERT_EMAIL_FROM` | Optional From. Default `Flux Alerts <onboarding@resend.dev>` (Resend bootstrap). After DNS verify, use e.g. `alerts@vsl-base.com` |
| `FLUX_ALERT_EMAIL_DEDUPE_HOURS` | Same fingerprint at most once per this many hours (default **6**). Stops hourly held-in-trust / offsite retries from flooding the inbox |
| `FLUX_RESEND_TIMEOUT_MS` | Resend HTTP timeout (default **15000**). Send failures are logged and never abort a backup |

**Resend DNS (brief):** In the Resend dashboard add domain `vsl-base.com` (or a dedicated send subdomain). Add the SPF + DKIM TXT records Resend shows in Cloudflare DNS. Do **not** replace the Email Routing **MX** records — those stay for inbound `justin@vsl-base.com`. Until the domain shows verified, keep `FLUX_ALERT_EMAIL_FROM` on `onboarding@resend.dev`. After verify, set From to `alerts@vsl-base.com` (or another address on the verified domain).

**Fallback — generic SMTP** (only if you have a real outbound relay; unused for sending when `FLUX_RESEND_API_KEY` is set):

| Variable | Role |
|----------|------|
| `FLUX_SMTP_HOST` / `FLUX_SMTP_PORT` / `FLUX_SMTP_USER` / `FLUX_SMTP_PASS` | Generic SMTP. Port **587** uses STARTTLS when advertised; port **465** uses implicit TLS |
| `FLUX_SMTP_URL` | Alternative: `smtp://user:pass@host:587` or `smtps://user:pass@host:465` |
| `FLUX_SMTP_SECURE` | Optional. `true` forces implicit TLS; default is implicit TLS only when the port is `465` |
| `FLUX_SMTP_TIMEOUT_MS` | SMTP I/O timeout (default **15000**) |

If `FLUX_ALERT_EMAIL_TO` is unset, or neither Resend nor SMTP is configured, alerting is a no-op (one debug log).

The backup-scheduler emails when: a platform freshness pipeline fails (includes `slug:hash` and `restore_failed` / other errors), offsite replication fails (including hourly retries of a held-in-trust upload), artifact validation fails, retention sweep fails, or a scheduler tick hard-fails. Messages are short: project identity when known, error, UTC timestamp.

**Setup**

1. Put `FLUX_ALERT_EMAIL_TO=justin@vsl-base.com` and `FLUX_RESEND_API_KEY=re_…` in `docker/web/.env` (see [`docker/web/.env.example`](../../../docker/web/.env.example)). SMTP vars are optional.
2. Recreate the control plane so `flux-web` reloads env: `docker compose -f docker/web/docker-compose.yml up -d --force-recreate` (or `./bin/deploy-web.sh` / `./bin/launch-web.sh --sync-env-apply`).
3. Confirm `docker logs flux-web` has no `ops-alert-email: send failed` after the next scheduler error.

This is **operator-only** visibility. It does not change backup trust tiers or destructive gates.

## Example

For multi-region or multi-cluster, document **which** Postgres cluster holds a tenant before running destructive maintenance.

## Next steps

- [Threat model](/docs/security/threat-model)
- [Environment variables](/docs/reference/env-vars)
- [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate)
