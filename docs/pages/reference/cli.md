---
title: CLI reference
description: Flux CLI overview, common commands, and where exhaustive help lives.
section: reference
---

# CLI reference

The **`flux`** CLI is the operator interface for provisioning, migrations, lifecycle, backups, and private database access.

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
| `flux push` | Apply a `.sql` file or ordered **`migrations/`** directory—**`--mode raw\|versioned\|repeatable`**, **`--force`** (repeatable), **`--plan`** / **`--dry-run`** preview directory pushes; pass **`--project`** / **`--hash`** (or **`flux.json`**) |
| `flux migrations list` | Show **`flux.flux_migrations`** ledger (remote state, not local files). **`flux migrations`** ≠ **`flux migrate`** (engine conversion) |
| `flux project credentials` | **v1 dedicated** → structured Postgres block (user, password, host, port, connection URL) plus anon/service JWT keys. **v2_shared** → gateway JWT secret and a short note. Use **`--field postgres.password`** (v1) for paste-friendly password-only output |
| `flux db password` | **v1 dedicated** → print only the Postgres password. **v2_shared** → explains temporary tunnel credentials (never pooled admin secrets) |
| `flux db tunnel` | Open local SSH tunnel; print GUI connection settings. **v1** → password via `flux db password`. **v2** → creates temporary scoped credentials when opening the tunnel |
| `flux db shell` | `psql` through the tunnel; **`--command 'SELECT 1'`** for non-interactive queries |
| `flux db dump` | **v2_shared** schema-scoped `pg_dump` via tunnel; use **`--schema-only`** with readonly temp roles when RLS blocks data |
| `flux db restore` | **v1 dedicated** `pg_restore` via tunnel (restore-verified backup gate). **v2_shared** refused for production pooled schemas |
| `flux db access-plan` / `flux db gui-config` | Redacted mode-aware metadata and copy-friendly GUI fields |
| `flux dump` | Legacy project export (see flags locally; distinct from `flux db dump`) |
| `flux migrate` | Orchestrate **v2_shared** → **v1_dedicated** via the control plane (see [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate)) |
| `flux logs` | Tail project logs when wired |
| `flux backup create` | Both engines — control plane streams `pg_dump -Fc`. v1: full project DB. v2: tenant API schema (`--schema=t_<short>_api --no-owner --no-acl`). See [Backups workflow](/docs/guides/backups) |
| `flux backup list` | Recent backups newest-first with trust labels (Restorable / Created, not restore-verified / Restore verification failed / etc.). Timestamps use the universal CLI format: `unixMs · ISO UTC · human UTC · relative`. Pass `--verbose` for artifact paths and full technical columns |
| `flux backup verify` | Runs **`pg_restore`** in a disposable Postgres container on the control plane. The only step that promotes a backup to **Restorable**. Requires `docker-cli` in the `flux-web` image (self-hosted operators) |
| `flux backup download` | Writes the custom-format archive to `-o <path>` (or shell redirect). Refuses binary output to a TTY |

**Private database access:** [Private database access guide](/docs/guides/database-access) — SSH tunnels, Beekeeper/DBeaver setup, password handoff.

**Operators (v2_shared):** If directory **`flux push`** fails on a legacy global migration ledger, run **`bin/migrate-pooled-ledger.sh`** on the Flux host — see [Migrations workflow](/docs/guides/migrations) and the root README.

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
flux db tunnel yeastcoast --hash ffca33f
flux db password yeastcoast --hash ffca33f
flux project credentials percept --hash b915ec8 --field postgres.password
flux backup download -p percept --hash b915ec8 --latest -o ./percept.dump
```

Use your own **slug** and **hash** from **`flux list`** (example values above).

## AI agents (MCP)

The **`@flux/mcp`** package exposes Flux control-plane tools to Cursor and other MCP clients. It reuses the same `/api/cli/v1/*` routes as the CLI but authenticates with a **scoped** [`FLUX_MCP_TOKEN`](/docs/reference/env-vars) from *Settings → MCP tokens* — not a broad `flx_live_` CLI key.

- Setup and capability presets: [`packages/mcp/README.md`](../../../packages/mcp/README.md) in the monorepo
- Release notes: [Flux MCP v0](/docs/release-notes/mcp-v0)
- Milestones and safety thesis: [`docs/AGENT_NATIVE_FLUX.md`](../../AGENT_NATIVE_FLUX.md)

## Next steps

- [Flux MCP v0 release notes](/docs/release-notes/mcp-v0)
- [Private database access](/docs/guides/database-access)
- [Configuration](/docs/reference/config)
- [Migrations workflow](/docs/guides/migrations)
- [Backups workflow](/docs/guides/backups)
- [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate)
