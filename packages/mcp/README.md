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

Same as the `flux` CLI: `FLUX_API_TOKEN` or `~/.flux/config.json` from `flux login`. Optional `FLUX_API_BASE` for non-default control planes.

## Run it locally

```bash
pnpm --filter @flux/mcp start
pnpm --filter @flux/mcp build
node packages/mcp/dist/index.cjs
```

## Register in Cursor

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

## Still deferred beyond Phase 4

Arbitrary write SQL, destructive lifecycle MCP tools (nuke, factory reset, restore, db-reset, project delete), scoped `flx_mcp_` tokens, streamable HTTP, dashboard approval UI.
