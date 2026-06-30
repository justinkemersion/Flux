# MCP smoke fixture project

Phase 4+ MCP mutation smoke (`flux.migration.apply`) must target a **dedicated fixture project**, not production or demo application projects.

**Auth (Phase 5):** create a scoped token at `/settings/mcp-tokens` and set `FLUX_MCP_TOKEN` in your MCP client. `FLUX_API_TOKEN` remains a temporary legacy fallback with stderr warning.

## Requirements

| Field | Expectation |
|-------|-------------|
| **Slug** | Contains `smoke`, `fixture`, or `test` (suggested: `mcp-smoke-fixture`) |
| **Mode** | `v2_shared` preferred |
| **Traffic** | No user-facing app traffic |
| **Backups** | Restore-verified backup available (smoke runs `flux.backup.ensureVerified`) |
| **Ledger** | Safe to accumulate harmless `9999_mcp_noop_smoke_*.sql` rows |
| **Metadata** | Description or brief mentions *fixture* / *smoke* / *test* |

Ledger rows from smoke are **real migration history**. Do not manually edit or delete them.

## Operator setup (once)

1. Create a disposable project on the Flux control plane, e.g. slug **`mcp-smoke-fixture`**, mode **v2_shared**.
2. Set project description to something like: `MCP smoke fixture — safe for noop migration ledger rows`.
3. Run `flux login` on the machine that executes smoke; note the project **hash** from `flux list` or the dashboard.
4. Ensure at least one restore-verified backup exists (smoke will call `flux.backup.ensureVerified`).

## Safe smoke command

```bash
pnpm --filter @flux/mcp exec tsx scripts/phase4-smoke.ts \
  --hash <fixture-hash> \
  --slug mcp-smoke-fixture \
  --yes-apply-smoke-migration
```

Required flags:

- `--hash` — 7-char hex project id (no default)
- `--slug` — project slug (no default)
- `--yes-apply-smoke-migration` — acknowledge real ledger write before apply

If the slug does **not** contain `smoke`, `fixture`, or `test`, the script **refuses** unless you also pass:

```bash
  --allow-non-fixture-project
```

Use that override only for exceptional lab targets — never for production app projects.

## Historical note

An early Phase 4 smoke run against a real app project (`bloom-atelier`) left one harmless ledger row (`9999_mcp_smoke_*.sql`, `SELECT version();`). Future runs must use this fixture project only.
