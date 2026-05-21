---
title: CLI reference
description: Flux CLI overview, common commands, and where exhaustive help lives.
section: reference
---

# CLI reference

The **`flux`** CLI is the operator interface for provisioning, migrations, lifecycle, and dumps.

## What you will learn

- How to discover commands locally
- Common verbs and their intent
- Relationship to dashboard operations

## The idea

Exact flags evolve—**`flux --help`** and subcommand help are authoritative for your installed version. This page orients you; it does not duplicate every flag (that belongs in `--help` and release notes).

### Common commands

| Command | Purpose |
|---------|---------|
| `flux login` | Verify API token / base URL |
| `flux init` | Link or create a project from repo-root `flux.json` (Foundry placeholder hash) |
| `flux create` | Provision a project |
| `flux list` | Show projects and Service URLs |
| `flux push` | Apply a `.sql` file or ordered **`migrations/`** directory—**`--plan`** / **`--dry-run`** preview directory pushes; pass **`--project`** / **`--hash`** (or **`flux.json`**) |
| `flux migrations list` | Show **`flux.flux_migrations`** ledger (remote state, not local files). **`flux migrations`** ≠ **`flux migrate`** (engine conversion) |
| `flux project credentials` | Print connection material: **v1 dedicated** → Postgres URI plus anon/service JWT keys; **v2_shared** → gateway JWT secret and a short note (no per-tenant Postgres URI). Pass **`[slug]`** and **`--hash`** like other project commands (or use **`flux.json`**) |
| `flux dump` | Export schema/data (see flags locally) |
| `flux migrate` | Orchestrate **v2_shared** → **v1_dedicated** via the control plane (see [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate)) |
| `flux logs` | Tail project logs when wired |
| `flux backup create` | Both engines — control plane streams `pg_dump -Fc`. v1: full project DB. v2: tenant API schema (`--schema=t_<short>_api --no-owner --no-acl`). See [Backups workflow](/docs/guides/backups) |
| `flux backup list` | Recent backups newest-first with trust labels (Restorable / Created, not restore-verified / Restore verification failed / etc.). Pass `--verbose` for catalog timestamps, artifact paths, and underlying tier names |
| `flux backup verify` | Runs **`pg_restore`** in a disposable Postgres container on the control plane. The only step that promotes a backup to **Restorable**. Requires `docker-cli` in the `flux-web` image (self-hosted operators) |
| `flux backup download` | Writes the custom-format archive to `-o <path>` (or shell redirect). Refuses binary output to a TTY |

### Identifiers

Codex / internal docs describe hashing:

- Resource pattern: `flux-{hash}-{slug}` (7-char hex hash segment)
- Slug is user-facing; hash is assigned at provision time

The same **Codex** contract JSON is available from the dashboard at **`GET /api/cli/v1/codex`** (useful for assistants and tooling).

## How it works

Install: [Installation](/docs/getting-started/installation).

### Foundry / app repo workflow

When the repo already has `flux.json` with `"hash": "REPLACE_AFTER_FLUX_INIT"`:

```bash
flux login
flux init
pnpm flux:schema:sync
flux push sql/migrations/ --plan
```

`flux init` writes the control-plane **slug**, **hash**, and optional **apiUrl** / **mode** / **apiSchema** into `flux.json`. It does **not** write JWT or gateway secrets—use `flux project credentials` or the dashboard for those.

## Example

```bash
flux --help
flux push --help
flux push db/migrations/0001_moods.sql --project percept --hash b915ec8
flux project credentials percept --hash b915ec8   # v1: copy the Postgres line for psql
flux backup download -p percept --hash b915ec8 --latest -o ./percept.dump
```

Use your own **slug** and **hash** from **`flux list`** (example values above).

## Next steps

- [Configuration](/docs/reference/config)
- [Migrations workflow](/docs/guides/migrations)
- [Backups workflow](/docs/guides/backups)
- [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate)
