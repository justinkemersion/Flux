# @flux/mcp

Flux MCP server — operate Flux projects from AI coding agents (Cursor, Claude Code, Codex, Gemini CLI, Windsurf, …) over the [Model Context Protocol](https://modelcontextprotocol.io).

This is **Pass 2**: read + preflight + **migration planning** + **bounded read-only DB query**. There are still **no write / apply / mutation tools** — those are deferred to Pass 3.

## What this is

A thin, additive [MCP](https://modelcontextprotocol.io) server that exposes the existing Flux control-plane API (`/api/cli/v1/*`) to AI agents. It reuses the exact same `ApiClient`, auth/config, migration-planning primitives, and DB-tunnel helpers as the `flux` CLI — no new control-plane routes, no new data-plane paths, and no changes to v1/v2 runtime behavior, provisioning, the gateway, backups, or PostgREST.

## Why there are still no write/apply tools

The server only registers **non-mutating** tools (`read`, `preflight`, `plan`, `credential`). Agents can observe a project, plan migrations, ask whether a destructive action *would* be allowed, and run **read-only** SQL — but they cannot apply migrations or write data. Durable mutation is Pass 3.

The guarantee is enforced in code: `assertNonMutatingTools` (see `src/policy.ts`) fails fast if any tool with a `write` or `destructive` intent is ever registered.

## Tools

### Pass 1 — read / preflight

- `flux.project.list` — list projects (slug, hash, status, API URL, lifecycle).
- `flux.project.describe` — metadata + lifecycle state + `FLUX.md` brief (plus non-failing advisories).
- `flux.schema.inspect` — tables, columns, keys, RLS, grants, warnings.
- `flux.schema.counts` — per-table row counts + schema summary.
- `flux.migrations.list` — applied migration ledger.
- `flux.doctor` — project health checks.
- `flux.activity` — recent activity timeline.
- `flux.backup.list` — backups and their validation/restore-verification state.
- `flux.destructive.preflight` — whether destructive actions are currently allowed (reuses `@flux/core/backup-trust`). **No mutation.**

### Pass 2 — plan / credential / read-only query

- `flux.migration.plan` — plan local `.sql` migrations against the applied ledger using the shared `@flux/core` planning primitives. Returns a `planId`, a stable `planHash`, files to apply/skip, conflicts, warnings, and whether the plan is destructive-shaped. **Plans only; never applies.** Plans are stored in memory for this pass.
- `flux.credentials.temporary` — issue a short-lived, **readonly**, project-scoped DB credential (**v2_shared only**). Access is always `ro`; never returns pooled-admin or service-role secrets.
- `flux.query.readonly` — run a single bounded read-only query (**v2_shared only**). Accepts only a single `SELECT`/`WITH` statement, rejects any non-read/privileged keyword, enforces a statement timeout, and wraps the query in a hard outer `LIMIT`. Uses a short-lived readonly credential over the same SSH tunnel as `flux db`.

Every tool returns the standard envelope:

```json
{ "ok": true, "summary": "human readable", "data": { }, "remediation": "optional next step" }
```

Tools never return tokens, JWT secrets, database passwords, or anon/service-role keys, and exactly one redacted audit line is written to **stderr** per call (`event: "flux_mcp_tool_call"`).

## Authentication

The server uses the same credentials as the `flux` CLI, resolved in this order:

1. `FLUX_API_TOKEN` environment variable.
2. `~/.flux/config.json` (written by `flux login`).

Optionally set `FLUX_API_BASE` to point at a non-default control plane.

Create a token in the Flux Dashboard (Settings → API keys), or run `flux login`.

## Run it locally

From the monorepo:

```bash
# Dev (no build step):
pnpm --filter @flux/mcp start

# Or build the bundled bin and run it:
pnpm --filter @flux/mcp build
node packages/mcp/dist/index.cjs
```

The process speaks MCP over stdio; it will sit waiting for an MCP client. Logs go to stderr.

## Register in Cursor

Add an entry to your Cursor MCP config (`~/.cursor/mcp.json` for global, or `.cursor/mcp.json` in a project). After `pnpm --filter @flux/mcp build`:

```json
{
  "mcpServers": {
    "flux": {
      "command": "node",
      "args": ["/absolute/path/to/flux/packages/mcp/dist/index.cjs"],
      "env": {
        "FLUX_API_TOKEN": "flx_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx_xxxx"
      }
    }
  }
}
```

Prefer not to build? Run the TypeScript entry directly with `tsx`:

```json
{
  "mcpServers": {
    "flux": {
      "command": "pnpm",
      "args": ["--filter", "@flux/mcp", "start"],
      "env": { "FLUX_API_TOKEN": "flx_live_..." }
    }
  }
}
```

The same `command`/`args`/`env` shape works for other MCP-capable agents (Claude Code, Codex, Gemini CLI, Windsurf).

## Examples

### `flux.migration.plan`

```json
{
  "name": "flux.migration.plan",
  "arguments": {
    "hash": "61d9dff",
    "workspaceRoot": "/abs/path/to/your/app",
    "migrationsPath": "migrations"
  }
}
```

Returns (abridged):

```json
{
  "ok": true,
  "summary": "Plan a1b2c3d4e5f6: 2 to apply, 1 to skip, 0 conflict(s).",
  "data": {
    "planId": "…uuid…",
    "planHash": "a1b2c3d4e5f6…",
    "apply": [{ "version": "0002_add_index.sql", "filename": "0002_add_index.sql", "checksum": "…" }],
    "skip": [{ "version": "0001_init.sql", "filename": "0001_init.sql", "checksum": "…" }],
    "conflicts": [],
    "destructiveShaped": false,
    "counts": { "apply": 2, "skip": 1, "conflicts": 0 }
  }
}
```

`workspaceRoot` is only inferred from the current directory when it contains a `flux.json`; otherwise it is required. Nothing is applied.

### `flux.query.readonly`

```json
{
  "name": "flux.query.readonly",
  "arguments": {
    "hash": "61d9dff",
    "sql": "SELECT id, title FROM products ORDER BY created_at DESC",
    "rowCap": 25
  }
}
```

The statement must be a single `SELECT`/`WITH`. A write attempt (e.g. `DELETE FROM products`) is rejected before any database access. The query is wrapped in a hard `LIMIT` and run under a statement timeout via a short-lived readonly credential.

## Deferred to Pass 3+

There are still **no write/apply/mutation tools**. `flux.migration.apply`, backup creation/verification tools, scoped `flx_mcp_` tokens, streamable HTTP transport, control-plane rate limiting, a persisted audit ledger, and the dashboard approval/audit console are intentionally **not** in Pass 2.
