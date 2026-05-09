---
title: Backups
description: What a Flux backup is, what it guarantees, and the trust states that decide whether you can rely on it.
section: concepts
---

# Backups

A Flux backup is a custom-format `pg_dump` archive of a project's data. It is created on demand or on a schedule, validated as a file, and only counts as **trustworthy** once a real `pg_restore` has succeeded against it in a disposable Postgres.

## What you will learn

- What a backup contains on **v1 dedicated** versus **v2 shared**
- The three trust states a backup moves through
- What backups guarantee and what they do not
- How backups gate destructive actions like `flux nuke`

## The idea

Backups exist to answer one question: **can this project's data be brought back if it is lost or corrupted right now?** The answer is "yes" only when a backup has been **created, validated, and restore-verified**. Anything short of that is a backup that *might* work; Flux is deliberate about not pretending otherwise.

## Two backup shapes

The same `flux backup` commands behave differently per engine because the underlying data shape is different.

| Engine | Backup contents | Catalog `kind` | Trustworthy use |
|--------|-----------------|----------------|-----------------|
| **v1 dedicated** | The full project Postgres database (`pg_dump -Fc` of the dedicated container) | `project_db` | Restoring this project's database, on this stack or another |
| **v2 shared** | Only the tenant API schema (`pg_dump -Fc --schema=t_<shortId>_api --no-owner --no-acl`) | `tenant_export` | Portable export of *your* tenant's tables and data — moving them, archiving them, importing into your own Postgres |

The v2 shape is intentionally narrower: a v2 backup is **not** a backup of the shared cluster. Shared-cluster disaster recovery is a platform operations concern (physical backups, WAL archiving, point-in-time recovery), separate from your project. A v2 backup gives you portability and an exit path; it does not give you cluster DR.

This is why `flux backup` on v2 is sometimes described as a **portable tenant export**. The mechanic is the same as v1 (custom-format archive, restore-verified in a disposable database), but the contract surface is different.

## The three trust states

Every backup moves through up to three states. The CLI and dashboard surface them as labels you can act on:

| State | What it means | What it lets you do |
|-------|---------------|---------------------|
| **Artifact validated** | The dump file exists on the control plane, has a non-zero size, and its checksum matches what the upload reported. | Confirms the file is *physically* there. Does **not** confirm it is restorable. |
| **Restore-verified** | A real `pg_restore` against this file succeeded in a disposable Postgres container. The schema and at least one non-system table came back as expected. | This is the only state that makes the backup **trustworthy** for production restore decisions. |
| **Offsite replicated** | A copy of the validated file lives in offsite storage (Backblaze B2, S3-compatible bucket, etc.). | Survives loss of the control-plane host. Independent of restore-verification. |

These are independent dimensions. A backup can be **artifact validated** and **offsite replicated** but not yet **restore-verified** — meaning the file is durably stored but you do not yet know whether it actually restores. The `restore-verified` flag is the one that gates trust.

The internal classifier names these tiers `artifact_pending`, `pipeline_incomplete`, `not_restore_verified`, `restore_verified` (called `restorable` in UI), `restore_failed`, and a few edge states. The dashboard and CLI translate them into the three readable labels above; the underlying tier names appear in detailed CLI output when you need to debug a stuck backup.

## What backups guarantee, and what they do not

| Guarantee | Limit |
|-----------|-------|
| The newest **restore-verified** backup of your project will restore that project's data into a Postgres of the same major version. | A backup is only as fresh as its last successful run. Between runs, recent writes are not protected. |
| v1 backups capture the full project database; v2 backups capture the tenant API schema in full. | v2 backups do **not** capture other tenants on the shared cluster, cluster-global objects, or roles. They are intentionally portable, not cluster-comprehensive. |
| Restoring a v1 backup into the same engine is a known-good path. | Restoring a v2 backup into a different engine (for example, importing a `tenant_export` into a fresh v1 dedicated stack) is supported but is a **migration**, not a like-for-like restore. |
| Offsite replication, when enabled, gives you durability against control-plane host loss. | Restoring from offsite alone is only safe when the offsite copy is itself restore-verified. "Uploaded" is not the same as "restorable." |

Flux backups are infrastructure for **your** business continuity decisions; they are not a guarantee that any particular dataset is safe. A clear way to think about it: Flux maintains backup *machinery*; you maintain backup *policy*.

## Backups and destructive actions

Flux uses the trust state to gate a small number of destructive CLI actions. The most prominent is `flux nuke`, which refuses to remove a project unless the latest backup is restore-verified:

```bash
flux nuke bloom-atelier --hash 0a1b2c3
# Refuses if the latest backup is not restore-verified.
# Override with --skip-backup-check (dangerous, prints a clear warning).
```

The intent is not paternalistic — the override exists, and it works. The intent is to make "destroy without a verified backup" a deliberate choice, not a default one.

Other destructive flows (engine migration, schema reset patterns) follow the same pattern: do the SQL after a `flux backup verify --latest` succeeds, not before.

## Where backups live

By default, backups are written to a control-plane Docker volume. On hosted Flux this is fully managed; on self-hosted installs the operator chooses the path with `FLUX_BACKUPS_LOCAL_DIR` (and `FLUX_BACKUPS_OFFSITE_DIR` for the offsite mirror). See [Production hardening](/docs/guides/production-hardening) for the operator side; an app builder on hosted Flux does not need to think about either path.

Retention is tier-dependent. Free projects get a small handful of recent backups; paid tiers get longer retention windows. The exact policy lives on the project page in the dashboard, not in this document, because it is the part most likely to evolve.

## Scheduling

| Engine | Automatic schedule | On-demand |
|--------|---------------------|-----------|
| **v1 dedicated** | Nightly (default) | Yes — `flux backup create` any time |
| **v2 shared** | None today | Yes — `flux backup create` any time |

The v2 shared scheduler is intentionally on-demand at this stage: a portable tenant export is a workflow trigger (before a migration, before a cutover), not background hygiene. v1 dedicated, where the backup is the project's full database, runs nightly because the operational expectation is closer to traditional Postgres backups.

## Next steps

- [Backups workflow](/docs/guides/backups) — how to create, list, verify, download, and restore in practice
- [Pooled vs dedicated](/docs/concepts/pooled-vs-dedicated) — the engine differences that shape what a backup contains
- [V1 dedicated quick SQL](/docs/guides/v1-dedicated-sql-workflows) — pre-destructive backup pattern in context
- [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate) — how `flux migrate` interacts with backups
- [Troubleshooting](/docs/reference/troubleshooting) — restore failures, missing artifacts, and the destructive-action gate
