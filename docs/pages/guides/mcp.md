---
title: Flux MCP for agents
description: Connect Cursor and other MCP clients to Flux with scoped tokens, capability presets, and the safety-gated migration workflow.
section: guides
tags: [mcp, agents, cursor]
status: beta
---

# Flux MCP for agents

Flux exposes the same control plane as the CLI and dashboard to AI coding tools through [Model Context Protocol](https://modelcontextprotocol.io) (MCP). Use it when you want Cursor, Codex, Claude Code, or another MCP client to inspect project state, plan migrations, or run the backup-gated apply loop — with scoped tokens and audited tool calls.

**Status:** beta (Flux MCP v0). Read-only tools are stable; controlled migration apply is capability-gated. Destructive lifecycle MCP tools remain blocked.

## What you will learn

- How Flux's three interfaces — dashboard, CLI, and MCP — fit together
- How to create a scoped `flx_mcp_` token with capability presets
- How to configure an MCP client (for example Cursor)
- The safe migration workflow and what agents cannot do

## The idea

Flux is a self-hosted Postgres backend and control plane. Operators use:

| Interface | Audience | Typical use |
|-----------|----------|-------------|
| **Dashboard** | Humans | Project catalog, schema explorer, backups, doctor, FLUX.md |
| **CLI** | Operators | `flux create`, `flux push`, migrations, backup-aware destructive flows |
| **MCP** | AI coding agents | Structured tool responses over `/api/cli/v1/*` — same routes as the CLI |

`@flux/mcp` is a thin stdio MCP server. It does not add new data-plane paths or bypass PostgREST. Agents receive `{ ok, summary, data, remediation? }` envelopes — never raw database passwords, pooled admin credentials, or long-lived JWT secrets.

Read-only and context tools are the **default** posture. Mutation requires explicit capabilities, restore-verified backup trust, and confirmation in the apply loop.

## Prerequisites

- A Flux account with at least one project
- Access to [**Settings → MCP tokens**](/settings/mcp-tokens) on your dashboard
- A checkout of the Flux monorepo (or a built `@flux/mcp` bundle) for the MCP server binary
- An MCP-capable client (Cursor, Claude Code, Codex, Windsurf, …)

## Create a scoped token

1. Sign in and open [**Settings → MCP tokens**](/settings/mcp-tokens).
2. Choose one or more projects and a capability preset (start with **read-only observer** or **migration planner** if you are exploring).
3. Copy the plaintext token **once** — only a hash and safe `keyPreview` are stored server-side.
4. Export it as `FLUX_MCP_TOKEN` in your MCP client config.

### Capability presets

| Preset | Capabilities | Typical tools |
|--------|----------------|---------------|
| **Read-only observer** | `project:read`, `schema:read`, `backup:read`, `intent:read`, `activity:read` | `flux.project.list`, `flux.schema.inspect`, `flux.backup.list`, `flux.activity` |
| **Schema inspector** | Same as read-only observer | `flux.schema.inspect`, `flux.schema.counts`, `flux.migrations.list` |
| **Migration planner** | Observer + `migration:plan` | `flux.migration.plan` (never applies) |
| **Read-only data inspector** | Observer + `query:readonly` | `flux.query.readonly`, `flux.credentials.temporary` (short-lived readonly) |
| **Controlled migration applier** | Planner + `backup:ensure_verified`, `migration:apply` | Full apply loop (shorter default expiry) |

Mutation-capable presets (`migration:apply`, `backup:ensure_verified`) use shorter default expiry. The dashboard warns when you select them.

## Configure your MCP client

Build the server if needed:

```bash
pnpm --filter @flux/mcp build
```

**Production (recommended):**

```json
{
  "mcpServers": {
    "flux": {
      "command": "node",
      "args": ["/path/to/flux/packages/mcp/dist/index.cjs"],
      "env": {
        "FLUX_MCP_TOKEN": "flx_mcp_...",
        "FLUX_API_BASE": "https://flux.vsl-base.com/api"
      }
    }
  }
}
```

**Development** (from monorepo root):

```json
{
  "mcpServers": {
    "flux": {
      "command": "pnpm",
      "args": ["--filter", "@flux/mcp", "start"],
      "env": {
        "FLUX_MCP_TOKEN": "flx_mcp_..."
      }
    }
  }
}
```

### Auth resolution order

| Priority | Source | Notes |
|----------|--------|--------|
| 1 | `FLUX_MCP_TOKEN` | **Recommended.** Scoped `flx_mcp_` token. |
| 2 | `FLUX_API_TOKEN` | Legacy `flx_live_` CLI key — stderr warning only; migrate to scoped tokens. |
| 3 | `~/.flux/config.json` | From `flux login` — same legacy warning. |

Optional `FLUX_API_BASE` overrides the control-plane API origin.

## Safe workflows

### Read and inspect (default)

Use read-only presets to list projects, inspect schemas, check migration ledger status, run project doctor, read activity, and load FLUX.md context — no side effects.

### Controlled migration apply

When a token includes `migration:apply` and `backup:ensure_verified`:

```text
inspect → plan → intent → ensure verified backup → preflight → apply
```

1. `flux.migration.plan` — plan local `.sql` files (never applies)
2. `flux.backup.ensureVerified` — ensure restore-verified backup trust
3. `flux.destructive.preflight` — check whether destructive-shaped plans may proceed
4. `flux.migration.apply` — apply only the prior plan's file set

Apply refuses stale plans, missing backup trust, and destructive-shaped SQL unless `allowDestructive: true`. There is no `skipBackupCheck` escape hatch on MCP tools.

See also: [Migrations workflow](/docs/guides/migrations), [Backups workflow](/docs/guides/backups).

## What agents cannot do

- **Destructive lifecycle** — nuke, factory reset, project delete, db-reset, and similar tools are **not registered** on the MCP server.
- **Arbitrary write SQL** — only planned migration apply via `flux.migration.apply`.
- **Secret leakage** — responses and audit payloads redact tokens, passwords, JWT secrets, artifact paths, and offsite storage details. Temporary readonly credentials are short-lived and scoped.
- **Unchecked automation** — mutating tools require persisted audit/intent rows and capability checks server-side and in the MCP layer.

Operator visibility: [**Agent Activity**](/agent-activity) lists sanitized MCP intents (session auth).

## Verify setup

Smoke read-only tools first:

- `flux.project.list`
- `flux.schema.inspect`
- `flux.doctor`

If you granted `migration:plan`, run `flux.migration.plan` against a linked workspace. Denied tools return `capability_denied` with remediation pointing to `/settings/mcp-tokens` — never the token value.

## Next steps

- [Flux MCP v0 release notes](/docs/release-notes/mcp-v0)
- [Environment variables](/docs/reference/env-vars) (`FLUX_MCP_TOKEN`)
- [CLI reference](/docs/reference/cli)
- Monorepo deep dive: [`packages/mcp/README.md`](../../../packages/mcp/README.md)
