---
title: CLI reference
description: Flux CLI overview, common commands, and where exhaustive help lives.
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
| `flux create` | Provision a project |
| `flux list` | Show projects and Service URLs |
| `flux push` | Apply SQL file(s) to a project—pass **`--project <slug>`** and **`--hash <7hex>`** from **`flux list`** (or use **`flux.json`**) |
| `flux project credentials` | Print connection material: **v1 dedicated** → Postgres URI plus anon/service JWT keys; **v2_shared** → gateway JWT secret and a short note (no per-tenant Postgres URI). Pass **`[slug]`** and **`--hash`** like other project commands (or use **`flux.json`**) |
| `flux dump` | Export schema/data (see flags locally) |
| `flux migrate` | Orchestrate **v2_shared** → **v1_dedicated** via the control plane (see [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate)) |
| `flux logs` | Tail project logs when wired |

### Identifiers

Codex / internal docs describe hashing:

- Resource pattern: `flux-{hash}-{slug}` (7-char hex hash segment)
- Slug is user-facing; hash is assigned at provision time

The same **Codex** contract JSON is available from the dashboard at **`GET /api/cli/v1/codex`** (useful for assistants and tooling).

## How it works

Install: [Installation](/docs/getting-started/installation).

## Example

```bash
flux --help
flux push --help
flux push db/migrations/0001_moods.sql --project percept --hash b915ec8
flux project credentials percept --hash b915ec8   # v1: copy the Postgres line for psql
```

Use your own **slug** and **hash** from **`flux list`** (example values above).

## Next steps

- [Configuration](/docs/reference/config)
- [Migrations workflow](/docs/guides/migrations)
- [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate)
