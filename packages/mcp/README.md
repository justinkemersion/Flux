# @flux/mcp

Flux MCP server — operate Flux projects from AI coding agents (Cursor, Claude Code, Codex, Gemini CLI, Windsurf, …) over the [Model Context Protocol](https://modelcontextprotocol.io).

This is **Phase 4 (v0)**: Phase 3A–3C **plus** controlled migration apply (`flux.migration.apply`). Arbitrary write SQL and destructive lifecycle MCP tools remain **deferred**.

## What this is

A thin, additive [MCP](https://modelcontextprotocol.io) server that exposes the existing Flux control-plane API (`/api/cli/v1/*`) to AI agents. It reuses the exact same `ApiClient`, auth/config, migration-planning primitives, and DB-tunnel helpers as the `flux` CLI — no new backup routes, no new data-plane paths, and no changes to v1/v2 runtime behavior, provisioning, the gateway, backup internals, or PostgREST.

## Policy (Phase 4)

Registered intents:

| Intent | Phase 4 |
|--------|---------|
| `read`, `preflight`, `plan`, `credential` | Allowed (non-mutating) |
| `protective_mutation` | Allowed **only** for `flux.backup.ensureVerified` |
| `write` | Allowed **only** for `flux.migration.apply` |
| `destructive` | **Blocked** at registration |

`assertRegisteredToolsPolicy` (see `src/policy.ts`) enforces the allowlist.

**Protective mutation** (`flux.backup.ensureVerified`) and **write** (`flux.migration.apply`) require persisted audit/intent APIs before side effects:

1. Check persistence client exists (`recordMcpAuditEvent`, `createMcpIntent`, `updateMcpIntent`).
2. For apply: validate stored migration plan locally (no push API yet).
3. Create a **pending** intent (`POST /api/cli/v1/intents`).
4. Policy gate (`assertProtectiveMutationPolicy` or `assertWriteDestructivePolicy` with `planId`).
5. Run side effect (backup ensure or ordered `pushSql` for planned migrations only).
6. Update intent terminal state (`PATCH /api/cli/v1/intents/:id`).
7. Finalize terminal audit (`POST /api/cli/v1/audit`).

If intent creation fails, **no backup or migration push API calls** are made. If intent finalization fails after a successful operation, the tool returns `ok: false` with safe metadata and remediation.

## Phase 3A — ledger before loaded gun

Every tool call:

1. Emits one redacted stderr audit line.
2. POSTs a redacted row to `POST /api/cli/v1/audit`.
3. For selected tools, also records an intent (`POST /api/cli/v1/intents` or pre/post lifecycle for protective mutation).

Audit persistence failure is **non-fatal** for read/plan/preflight/credential tools. **Fatal** for protective mutation (and future write/destructive tools).

## Tools

### Pass 1 — read / preflight

- `flux.project.list` — list projects (slug, hash, status, API URL, lifecycle).
- `flux.project.describe` — metadata + lifecycle state + `FLUX.md` brief (plus non-failing advisories).
- `flux.schema.inspect` — tables, columns, keys, RLS, grants, warnings.
- `flux.schema.counts` — per-table row counts + schema summary.
- `flux.migrations.list` — applied migration ledger.
- `flux.doctor` — project health checks.
- `flux.activity` — recent activity timeline.
- `flux.backup.list` — sanitized backup summaries (trust tier, validation/restore state). **No paths, offsite storage details, or raw API rows.**
- `flux.destructive.preflight` — whether destructive actions are currently allowed (reuses `@flux/core/backup-trust`). **No mutation.**

### Pass 2 — plan / credential / read-only query

- `flux.migration.plan` — plan local `.sql` migrations (never applies).
- `flux.credentials.temporary` — short-lived **readonly** v2 credential.
- `flux.query.readonly` — bounded read-only SQL over the SSH tunnel.

### Phase 3B — protective mutation

- `flux.backup.ensureVerified` — ensure a **restore-verified** backup exists. Reuses an existing restore-verified backup when fresh enough (`verifyLatestIfFresh`, optional `maxAgeHours`); otherwise creates and verifies via existing `createProjectBackup` / `verifyProjectBackup` client methods. **Never accepts `skipBackupCheck`.** Output excludes artifact paths, volume roots, offsite keys/buckets, signed URLs, and credentials.

**Suggested agent flow (Phase 4):**

```text
inspect → plan → intent → ensure verified backup → preflight → apply
```

1. `flux.migration.plan`
2. `flux.backup.ensureVerified`
3. `flux.destructive.preflight`
4. `flux.migration.apply`

### Phase 4 — controlled migration apply

- `flux.migration.apply` — apply **only** files from a prior `flux.migration.plan` apply set via existing CLI `pushSql`. Re-reads local files; refuses stale/missing plans. Requires restore-verified backup by default. Destructive-shaped plans require `allowDestructive: true`. **Never accepts `skipBackupCheck`.**

**`flux.migration.apply` input schema:**

```json
{
  "hash": "abc1234",
  "slug": "optional-label",
  "planId": "uuid-from-plan",
  "planHash": "sha256-from-plan",
  "workspaceRoot": "/abs/repo",
  "migrationsPath": "migrations",
  "reason": "optional audit note",
  "requireVerifiedBackup": true,
  "allowDestructive": false
}
```

Required: `hash`, `planId`, `planHash`, `migrationsPath`. Defaults: `requireVerifiedBackup: true`, `allowDestructive: false`.

**Partial apply (Phase 4B Slice A):** If apply stops after some files succeed, the tool returns `ok: false` with a structured summary, remediation, and safe `data` (`partialApply`, `failureIndex`, `remainingFiles`, `appliedFiles`, `failedFile`). Push error bodies are never echoed (no raw SQL). Remediation warns that ledger rows are real history — **do not manually edit or delete them**. Re-run `flux.migration.plan` before retrying apply.

**Stale plan refusal (Phase 4B Slice B):** Apply refuses when the stored plan is missing, mismatched, or no longer matches local files or ledger state. Every refusal uses gate `migration_apply_blocked_stale_plan`, a typed `data.staleReason`, and remediation that tells the agent to re-run `flux.migration.plan`. No raw SQL, absolute paths, tokens, or credentials appear in the response.

| `staleReason` | Typical cause | Remediation |
|---------------|---------------|-------------|
| `plan_not_found` | Unknown `planId` or MCP server restarted (in-memory plan store) | Re-run `flux.migration.plan` |
| `plan_hash_mismatch` | Submitted `planHash` ≠ stored plan | Re-run `flux.migration.plan`; apply new `planId` + `planHash` |
| `plan_file_missing` | Planned `.sql` file removed locally | Restore file or re-plan from current workspace |
| `plan_file_checksum_mismatch` | Local file changed after planning | Re-run `flux.migration.plan` before apply |
| `plan_conflicts_present` | Plan has checksum conflicts | Resolve conflicts; re-plan |
| `plan_apply_set_changed` | Ledger or apply set drifted since planning | Re-run `flux.migration.plan` |
| `plan_workspace_invalid` | `workspaceRoot` not Flux-linked | Fix workspace; re-plan |
| `plan_migrations_path_invalid` | `migrationsPath` missing or unreadable | Fix path; re-plan |

Safe `data` fields on stale refusal: `planId`, `planHash` (when known), `staleReason`, `expectedPlanHash`, `actualPlanHash` (hash mismatches only), `changedFiles` / `missingFiles` (filenames only), `gate`, `errorCode`, `intentId` (when intent was created before drift check).

### `flux.backup.ensureVerified` input schema

```json
{
  "hash": "abc1234",
  "slug": "optional-label",
  "reason": "optional audit note",
  "verifyLatestIfFresh": true,
  "maxAgeHours": 24,
  "wait": true
}
```

Required: `hash`. Defaults: `verifyLatestIfFresh: true`, `wait: true`.

### Phase 3C — sanitized backup outputs

Backup-facing MCP tools (`flux.backup.list`, `flux.backup.ensureVerified`) sanitize control-plane backup API responses in the MCP layer (the underlying CLI API is unchanged). Agents receive only safe fields:

- `backupId`, `status`, `kind`, `format`, timestamps, validation/restore status (+ derived booleans), per-row `trustTier` / `detail`, `sizeBytes`, list-level `platformBackupCompliant`

Stripped/redacted: local/absolute artifact paths, volume roots, signed URLs, offsite keys/buckets/providers, checksums, and raw backup rows. Audit stderr lines also redact path-like string values.

Every tool returns:

```json
{ "ok": true, "summary": "human readable", "data": { }, "remediation": "optional next step" }
```

## Authentication

MCP resolves tokens in this order:

1. **`FLUX_MCP_TOKEN`** (recommended) — scoped `flx_mcp_` token from Dashboard → [Settings → MCP tokens](/settings/mcp-tokens)
2. **`FLUX_API_TOKEN`** (legacy fallback) — broad `flx_live_` CLI key; stderr warns to migrate
3. **`~/.flux/config.json`** — from `flux login`; stderr warns to migrate

Optional `FLUX_API_BASE` for non-default control planes.

### Capability presets (create tokens in the dashboard)

| Use case | Suggested capabilities |
|----------|------------------------|
| Read-only agent | `project:read`, `schema:read`, `activity:read`, `intent:read` |
| Migration planner | above + `migration:plan`, `backup:read` |
| Controlled migration applier | planner set + `migration:apply`, `backup:ensure_verified` (shorter expiry) |

`FLUX_MCP_TOKEN` must be a valid `flx_mcp_…` token. Invalid values fail at MCP startup with a clear error.

### Phase 5 Slice F — redaction, audit identity, capability guard

When using `FLUX_MCP_TOKEN`:

- **Defense-in-depth:** before calling the control plane, the MCP server checks the cached token profile from `GET /api/cli/v1/auth/verify` and denies tools that lack the required capability (e.g. `flux.migration.apply` needs `migration:apply`). Denials name the tool and capability and point to `/settings/mcp-tokens` — never the token value.
- **Legacy `FLUX_API_TOKEN`:** still works with a stderr warning; local capability preflight is skipped (route enforcement remains).
- **Redaction:** full/partial `flx_mcp_…` strings and `Authorization: Bearer flx_mcp_…` are scrubbed from stderr audit lines, persisted audit/intent payloads, and dashboard sanitized views. Safe `keyPreview` fragments (`flx_mcp_abcd…0123`) are allowed.
- **Audit/intent enrichment:** MCP-authenticated rows store `authFamily: "mcp"`, `keyType: "mcp"`, `keyPreview`, and `embeddedKeyId` in metadata — never plaintext token or hash.

Formal `flx_live_` deprecation clock remains deferred to Slice G.

## Run it locally

```bash
pnpm --filter @flux/mcp start
pnpm --filter @flux/mcp build
node packages/mcp/dist/index.cjs
```

### Phase 4 live smoke (fixture project only)

The Phase 4 smoke script writes a **real migration ledger row**. It never defaults to a project — you must pass `--hash` and `--slug`, use a **fixture-looking slug**, and acknowledge apply explicitly.

**Operator setup:** [`plans/mcp/fixture-project.md`](../../plans/mcp/fixture-project.md) (suggested slug: `mcp-smoke-fixture`, v2_shared).

```bash
pnpm --filter @flux/mcp exec tsx scripts/phase4-smoke.ts \
  --hash <fixture-hash> \
  --slug mcp-smoke-fixture \
  --yes-apply-smoke-migration
```

- `--hash` and `--slug` are **required** (no positional args, no env inference, no first-project selection).
- Slug must contain `smoke`, `fixture`, or `test` — otherwise the script **refuses** unless you also pass `--allow-non-fixture-project`.
- `--yes-apply-smoke-migration` is **required** before `flux.migration.apply` runs.
- Smoke migration file: `9999_mcp_noop_smoke_<suffix>.sql` — comment + `SELECT version();` only (no DDL/DML).
- Ledger rows are **real history** — do not manually edit or delete them.

Steps 1–3 (plan, ensure verified backup, preflight) run without the apply acknowledgement; apply and stale-plan check refuse without it. Non-fixture slugs never run silently.

## Register in Cursor

**Preferred (scoped MCP token):**

```json
{
  "mcpServers": {
    "flux": {
      "command": "node",
      "args": ["/absolute/path/to/flux/packages/mcp/dist/index.cjs"],
      "env": { "FLUX_MCP_TOKEN": "flx_mcp_..." }
    }
  }
}
```

Create the token at `/settings/mcp-tokens` on your Flux dashboard. Plaintext is shown once at creation.

**Legacy (broad CLI key — temporary):**

```json
{
  "mcpServers": {
    "flux": {
      "command": "node",
      "args": ["/absolute/path/to/flux/packages/mcp/dist/index.cjs"],
      "env": { "FLUX_API_TOKEN": "flx_live_..." }
    }
  }
}
```

The MCP server logs a stderr warning when using `FLUX_API_TOKEN` or `~/.flux/config.json` instead of `FLUX_MCP_TOKEN`.

## Still deferred beyond Phase 4

Arbitrary write SQL, destructive lifecycle MCP tools (nuke, factory reset, restore, db-reset, project delete), streamable HTTP, dashboard approval UI. Scoped `flx_mcp_` tokens: Phase 5 (see `plans/mcp/phase-5-scoped-mcp-tokens.md`).
