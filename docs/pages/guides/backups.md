---
title: Backups workflow
description: Create, verify, download, and restore Flux backups from the CLI on v1 dedicated and v2 shared.
section: guides
---

# Backups workflow

This guide walks the everyday backup commands. The mental model behind them — what a backup contains per engine, the three trust states, what backups guarantee — lives in [Backups (concept)](/docs/concepts/backups). Read that page first if any of those terms are new.

## What you will learn

- How to create, list, verify, and download backups from the CLI
- How to restore a backup (engine-specific mechanics)
- The pre-destructive workflow pattern most projects need
- How to wire backups into CI before staged deploys
- How to read trust labels and recover when they say something is wrong

## Prerequisites

- The Flux CLI installed and logged in (`flux login`).
- A project's `slug` and seven-character `hash` from `flux list` (or a `flux.json` carrying both — see [Configuration](/docs/reference/config)).
- Disk space for the artifact when you download — `pg_dump -Fc` archives are compressed but can still be substantial for active projects.

## 1) Create a backup

Both engines use the same command. The control plane runs `pg_dump` server-side and stores the artifact in its own backup volume:

```bash
flux backup create --project bloom-atelier --hash 0a1b2c3
```

On **v1 dedicated** the artifact is the full project database. On **v2 shared** it is the tenant API schema only (`pg_dump -Fc --schema=t_5ecfa3ab72d1_api --no-owner --no-acl`). Both run in the same command shape; the engine determines the contents.

Creating a backup does **not** make it trustworthy. The fresh artifact is in the **artifact validated** state at best — the file exists and looks structurally fine. Promoting it to **restore-verified** is a separate step (see [3](#3-verify-a-backup)).

A common shortcut is to chain create and verify:

```bash
flux backup create --project bloom-atelier --hash 0a1b2c3 \
  && flux backup verify --project bloom-atelier --hash 0a1b2c3 --latest
```

This is the single most useful one-liner before any destructive action.

## 2) List backups

```bash
flux backup list --project bloom-atelier --hash 0a1b2c3
```

The output shows recent backups newest-first with their trust labels (per [the three trust states](/docs/concepts/backups#the-three-trust-states)). Common labels:

- **Restorable** — restore-verified, safe to act on.
- **Created, not restore-verified** — file exists and looks valid; nobody has tried to restore it yet.
- **Restore verification failed** — the artifact exists but `pg_restore` did not reproduce a usable database. Treat as broken.
- **Validating backup artifact** — the upload finished moments ago and the validator is still catching up. Wait briefly and re-list.
- **No backups** — exactly what it says; create one.

Pass `--verbose` for catalog timestamps, artifact paths, and the underlying tier names. Useful when a label looks wrong and you need to trace it.

## 3) Verify a backup

This is the only step that promotes a backup to **restorable**. Verification runs `pg_restore` against the artifact in a disposable Postgres container on the control plane and checks that the schema and at least one non-system table came back:

```bash
flux backup verify --project bloom-atelier --hash 0a1b2c3 --latest
```

Verify the latest with `--latest`, or a specific row with `--id <backupId>`. If verification fails, the row's trust label flips to **Restore verification failed** and the underlying error is recorded in the catalog — `flux backup list --verbose` will show it.

Restore verification is the contract. A backup that has never been verified is, operationally, not a backup yet. The pre-destructive pattern in [Section 6](#6-pre-destructive-workflow-pattern) is built around this idea.

## 4) Download a backup

```bash
flux backup download --project bloom-atelier --hash 0a1b2c3 --latest -o ./bloom.dump
```

Pass `--latest` (newest backup) or `--id <backupId>` (a specific row). The artifact is binary (`pg_dump -Fc`); the CLI refuses to write it to a terminal without `-o` or a redirect to avoid garbling the shell:

```bash
# Equivalent — redirect instead of -o
flux backup download --project bloom-atelier --hash 0a1b2c3 --latest > ./bloom.dump
```

The downloaded file is a standard Postgres custom-format archive. `pg_restore --list ./bloom.dump` works against it without any Flux-specific tooling.

## 5) Restore a backup

There is no `flux backup restore` command today. Restoring is a two-step manual flow on both engines, deliberately so — the engines have different restore targets:

### v1 dedicated — restore into the project's own Postgres

Get the project's Postgres connection string from the CLI:

```bash
flux project credentials bloom-atelier --hash 0a1b2c3
# Copy the Postgres URI under the "Postgres" section.
```

Run `pg_restore` from your machine:

```bash
pg_restore --clean --if-exists --no-owner --no-acl \
  --dbname "<paste Postgres URI>" \
  ./bloom.dump
```

`--clean --if-exists` drops existing objects before recreating them. Skip those flags if you want to overlay onto an empty database instead.

### v2 shared — restore into a Postgres you control

A v2 backup is a tenant export, not a shared-cluster restore. The intended targets are:

- A v1 dedicated stack you are migrating to (`flux migrate` does this for you — see [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate)).
- Your own Postgres for archival, off-platform analysis, or running locally.

The restore is a normal `pg_restore` against any Postgres with the same major version; the dump is portable:

```bash
pg_restore --no-owner --no-acl \
  --dbname "postgresql://user:pass@host/your_database" \
  ./bloom.dump
```

The dump uses `--no-owner --no-acl` at create time, so role names and grants do not need to line up between the source tenant and the restore target. Re-create your application roles and grants in the target database before serving traffic.

## 6) Pre-destructive workflow pattern

The most common reason to use Flux backups in day-to-day work is "back up before doing something risky." The pattern is the same regardless of engine:

```bash
# 1. Create + verify in one shot
flux backup create --project bloom-atelier --hash 0a1b2c3 \
  && flux backup verify --project bloom-atelier --hash 0a1b2c3 --latest

# 2. Confirm the latest is restore-verified
flux backup list --project bloom-atelier --hash 0a1b2c3 | head -3

# 3. Do the risky thing — apply a migration, drop a column, run a destructive script
flux push ./db/migrations/0042_drop_legacy_table.sql

# 4. If something is wrong, the verified backup is the recovery path
```

This pattern is the same one [V1 dedicated quick SQL](/docs/guides/v1-dedicated-sql-workflows) and [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate) link to. It is not engine-specific; it is destructive-action-specific.

`flux nuke` enforces the pattern by default — it refuses to remove a project unless the latest backup is restore-verified. The override (`--skip-backup-check`) exists for cases where you genuinely want to destroy without a recovery path; the warning text on stderr makes the choice explicit.

## 7) CI pattern: backup before staged deploy

Wiring this into CI is straightforward. The shape that works for most teams:

```yaml
# Pseudocode — adapt to your CI runner
- name: Backup production project
  run: |
    flux backup create --project ${{ vars.FLUX_PROJECT_SLUG }} --hash ${{ vars.FLUX_PROJECT_HASH }}
    flux backup verify --project ${{ vars.FLUX_PROJECT_SLUG }} --hash ${{ vars.FLUX_PROJECT_HASH }} --latest

- name: Apply migrations
  run: flux push ./db/migrations/

# If migration fails, the verified backup is recoverable.
```

Keep the API token used here narrow — read-write to the projects it touches, nothing more. See [Project secrets](/docs/security/project-secrets).

## Common pitfalls

| Symptom | Likely cause |
|---------|--------------|
| `flux backup verify` consistently fails | Postgres major-version mismatch between the verify image and the source; or the tenant schema was deleted between create and verify |
| List always shows "Validating backup artifact" | The validator is stalled or the upload truncated; re-create and watch `--verbose` for the artifact size |
| Download writes nothing to disk | Forgot `-o` or a shell redirect on a TTY (the CLI refuses binary to terminal) |
| `flux nuke` refuses with "not restore-verified" | Latest backup is in a non-restorable trust state; create + verify, or pass `--skip-backup-check` if you really mean to destroy without a recovery path |
| Old backup artifact missing on disk | Retention swept it; older rows can have valid metadata but no file. Check the project's retention window in the dashboard |

The full symptom-by-symptom map for backup failures lives in [Troubleshooting](/docs/reference/troubleshooting).

## Next steps

- [Backups (concept)](/docs/concepts/backups) — what backups guarantee and what they do not
- [V1 dedicated quick SQL](/docs/guides/v1-dedicated-sql-workflows) — pre-destructive pattern in context
- [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate) — how `flux migrate` produces and consumes backups
- [CLI reference](/docs/reference/cli) — every backup flag in detail
- [Troubleshooting](/docs/reference/troubleshooting) — restore failures and the destructive-action gate
