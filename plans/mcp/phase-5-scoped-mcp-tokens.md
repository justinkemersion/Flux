# Flux MCP Phase 5 — Scoped MCP Tokens (`flx_mcp_`)

**Status:** Phase 5 complete (Slices A–G) — scoped MCP tokens are the recommended default; `FLUX_API_TOKEN` for MCP remains `supported_with_warning`.  
**Precedes:** Streamable HTTP transport, new mutation MCP tools, org/team RBAC  
**Builds on:** Phase 4 (`flux.migration.apply`), Phase 4B (intent visibility, Agent Activity, fixture smoke discipline)

---

## 1. Executive summary

Flux MCP has graduated from read-only introspection to **bounded mutation**: migration planning, readonly query via temp credentials, protective backup verification, controlled migration apply, persisted audit/intents, and operator visibility in Agent Activity. Today the MCP server authenticates with the same broad `flx_live_` CLI keys used for `flux login`, `flux create`, `flux push`, `flux migrate`, and full project lifecycle.

That coupling was acceptable for local v0, but it is no longer proportionate. A compromised agent config file or leaked env var currently grants **full CLI power** across **all projects** owned by the user, with **no expiry** and **no per-tool limits**.

Phase 5 introduces **`flx_mcp_` tokens**: dashboard-issued credentials scoped by **project**, **capability**, and **expiry**. MCP prefers `FLUX_MCP_TOKEN`; `flx_live_` remains the CLI family. MCP routes enforce scope server-side; audit and intents record the MCP key id (not the secret). Plaintext tokens are shown once at creation and never stored.

This phase is **additive**: new table, new auth path, new dashboard UI slice, route guards on MCP-facing CLI endpoints. No changes to v1/v2 runtime, gateway, provisioning, or PostgREST.

---

## 2. Threat model

| Threat | Today | Phase 5 mitigation |
|--------|--------|-------------------|
| **Broad CLI token in MCP config** | Cursor `mcpServers.flux.env.FLUX_API_TOKEN` often holds a full `flx_live_` key with create/push/migrate/delete power. | Issue `flx_mcp_` with only the capabilities the agent needs; MCP prefers `FLUX_MCP_TOKEN`. |
| **Agent compromise** | Stolen MCP env grants full account CLI access; attacker can pivot to unrelated projects and destructive ops. | Scoped projects + capabilities limit blast radius; short `expiresAt` bounds exposure window. |
| **Accidental cross-project access** | `flux.project.list` returns all user projects; any hash in tool args is accepted if the user owns it. | Token `projectIds` restrict which hashes resolve; out-of-scope requests return `403` before side effects. |
| **Long-lived local credentials** | `flx_live_` keys have no expiry; `~/.flux/config.json` persists indefinitely. | MCP tokens require `expiresAt`; expired tokens rejected at auth; dashboard shows expiry prominently. |
| **Excessive mutation permissions** | Same key powers `flux.migration.apply`, backup create/verify, temp DB credentials, and (via CLI) `flux push` on arbitrary SQL. | `migration:apply` and `backup:ensure_verified` are separate capabilities; MCP tokens cannot call non-MCP CLI routes (create, init, migrate, nuke, raw push). |
| **Token leakage in logs/config** | Tokens may appear in MCP client config, shell history, or stderr if mis-logged. | Hashed storage only; audit stores `keyId` (UUID), never secret; extend `mcp-secret-scan` for `flx_mcp_`; redact in MCP stderr audit lines. |

**Residual risk (accepted for Phase 5):** a token with `migration:apply` + `backup:ensure_verified` on a project can still mutate that project's schema via the existing controlled apply path. That is intentional — scope reduces reach, not eliminate write power where explicitly granted.

---

## 3. Token format

### Prefix and shape

Family: **`flx_mcp_`**, mirroring CLI key ergonomics in `apps/dashboard/src/lib/cli-api-auth.ts`:

```text
flx_mcp_<12 hex keyId>_<20 hex secret>_<4 hex checksum>
```

- **`keyId`** — 12 hex chars embedded in the token; stored in `flux_mcp_tokens.key_id` (unique) for audit correlation without the secret.
- **Secret** — 20 hex chars; contributes entropy; never stored except as part of the one-time plaintext token.
- **Checksum** — first 4 hex chars of `SHA-256("flx_mcp_" + keyId + "_" + secret)` — early reject before DB lookup.
- **Regex-stable prefix** for gateways and log scanners.

Implemented in `apps/dashboard/src/lib/mcp-token-auth.ts`: `generateMcpToken`, `parseMcpToken`, `hashMcpToken`, `previewMcpToken`, `isMcpTokenLike`.

### Visible key id and preview

- **`id`** — UUID primary key (row id; referenced as `keyId` in `mcp_audit_events` / `mcp_intents` when authenticated).
- **`key_id`** — embedded 12-hex segment (same as token body); unique index for operator grep.
- **`keyPreview`** — safe display string, e.g. `flx_mcp_abcd…3f9a` (prefix + first 4 of keyId + ellipsis + last 4 of secret). Not sufficient to authenticate.

### Storage

- **Persist:** `keyHash` = `SHA-256(full token)` hex digest (same as `hashFluxCliKeySecret`).
- **Never persist:** full token, random segment alone, or reversible encryption of the secret.
- **Show once:** creation response includes `{ token, keyPreview, id, expiresAt, capabilities, projectIds }`; UI copy: "Copy now — you won't see this again."

---

## 4. Database model

### Table name

**`flux_mcp_tokens`** (parallel to `flux_api_keys`, distinct lifecycle and columns).

### Columns

| Column | Type | Notes |
|--------|------|--------|
| `id` | `uuid` PK | Row id; referenced as `keyId` in audit/intents when authenticated. |
| `userId` | `text` FK → `users.id` | Owner; cascade delete. |
| `keyHash` | `text` UNIQUE NOT NULL | SHA-256 hex of full token. |
| `keyId` | `text` UNIQUE NOT NULL | Embedded 12-hex audit segment from token body. |
| `keyPreview` | `text` NOT NULL | Safe display fragment, e.g. `flx_mcp_abcd…3f9a`. |
| `projectIds` | `jsonb` NOT NULL | JSON array of project UUID strings; **at least one** required at creation. |
| `capabilities` | `jsonb` NOT NULL | JSON array of capability strings; **at least one** required. |
| `expiresAt` | `timestamptz` NOT NULL | Hard expiry; tiered defaults (see below). |
| `revokedAt` | `timestamptz` NULL | Set on revoke; auth treats non-null as invalid. |
| `createdAt` | `timestamptz` NOT NULL DEFAULT now() | |
| `lastUsedAt` | `timestamptz` NULL | Throttled updates (same 1h throttle pattern as CLI keys). |
| `metadata` | `jsonb` NULL | Optional operator hints; no secrets. |

**Slice A note:** `name` column deferred to Slice D (dashboard CRUD).

### Expiry tiers

| Token class | Condition | Default | Max |
|-------------|-----------|---------|-----|
| **Read-only** | No `migration:apply` or `backup:ensure_verified` | 30 days | 90 days |
| **Mutation-capable** | Includes `migration:apply` and/or `backup:ensure_verified` | 7 days | 30 days |

Helpers in `apps/dashboard/src/lib/mcp-capabilities.ts`: `defaultMcpTokenExpiryDays`, `maxMcpTokenExpiryDays`, `validateMcpTokenExpiry`, `isMutationCapableMcpToken`. Anything with apply/ensure_verified should feel **temporary by default**.

### Indexes

```sql
CREATE INDEX flux_mcp_tokens_user_id_idx ON flux_mcp_tokens (user_id);
CREATE INDEX flux_mcp_tokens_key_id_idx ON flux_mcp_tokens (key_id);
CREATE INDEX flux_mcp_tokens_expires_at_idx ON flux_mcp_tokens (expires_at);
CREATE INDEX flux_mcp_tokens_revoked_at_idx ON flux_mcp_tokens (revoked_at);
CREATE INDEX flux_mcp_tokens_project_ids_gin_idx ON flux_mcp_tokens USING GIN (project_ids);
CREATE INDEX flux_mcp_tokens_capabilities_gin_idx ON flux_mcp_tokens USING GIN (capabilities);
```

### Bootstrap

Additive DDL in `apps/dashboard/src/lib/db/system-db-bootstrap.ts` — `CREATE TABLE IF NOT EXISTS flux_mcp_tokens (...)` — no changes to `flux_api_keys`.

### Project scope resolution

- **Store** project UUIDs in `projectIds` (jsonb array).
- **Accept** project **hash** (7 hex) at API/tool layer.
- **Auth layer** resolves `hash` → `projects.id` for `userId`, then asserts `projects.id` is in `projectIds`.
- `flux.project.list`: return **intersection** of user projects and token `projectIds` (not all owned projects).

### Capability distinctions

- **`intent:read`** — structured control-loop state (`GET /api/cli/v1/intents`, intent detail). MCP plan/apply/audit correlation.
- **`activity:read`** — operator/project timeline visibility (`flux.activity`, `GET …/activity`). Distinct from intent ledger.

**No `mcp_token:manage` capability.** Token creation and revocation remain **dashboard session only** in Phase 5 — agents cannot mint or revoke MCP tokens via MCP/CLI.

---

## 5. Capability model

Capabilities are **strings** stored in `capabilities[]` and checked on every MCP-facing CLI route invocation.

### Proposed capabilities

| Capability | Grants access to |
|------------|------------------|
| `project:read` | `flux.project.list`, `flux.project.describe`, `flux.doctor`; CLI `GET …/metadata`, `…/lifecycle-state`, `…/doctor`, `GET /api/cli/v1/list` (filtered) |
| `schema:read` | `flux.schema.inspect`, `flux.schema.counts`, `flux.migrations.list`; CLI `…/schema-inspection`, `…/migrations` |
| `backup:read` | `flux.backup.list`, `flux.destructive.preflight`; CLI `…/backups` (list/metadata only, not download) |
| `backup:ensure_verified` | `flux.backup.ensureVerified`; CLI `POST …/backups`, `POST …/backups/:id/verify` |
| `migration:plan` | `flux.migration.plan`; intent create for `plan` class (no push) |
| `migration:apply` | `flux.migration.apply`; CLI `POST /api/cli/v1/push` **only** when called from MCP apply orchestration (versioned migration metadata); still subject to plan/backup gates |
| `query:readonly` | `flux.credentials.temporary` (readonly TTL only), `flux.query.readonly`; CLI `…/db-access/temporary-credential` (access=readonly), `…/query` |
| `intent:read` | `GET /api/cli/v1/intents`, `GET /api/cli/v1/intents/:id` (sanitized list/detail for operator/agent introspection) |
| `activity:read` | `flux.activity`; CLI `GET …/activity` |

### Tool → capability map (MCP server)

| MCP tool | Required capability |
|----------|---------------------|
| `flux.project.list` | `project:read` |
| `flux.project.describe` | `project:read` |
| `flux.doctor` | `project:read` |
| `flux.schema.inspect` | `schema:read` |
| `flux.schema.counts` | `schema:read` |
| `flux.migrations.list` | `schema:read` |
| `flux.backup.list` | `backup:read` |
| `flux.destructive.preflight` | `backup:read` |
| `flux.backup.ensureVerified` | `backup:ensure_verified` |
| `flux.migration.plan` | `migration:plan` |
| `flux.migration.apply` | `migration:apply` (+ `migration:plan` was required earlier in the flow — see implicit deps) |
| `flux.credentials.temporary` | `query:readonly` |
| `flux.query.readonly` | `query:readonly` |
| `flux.activity` | `activity:read` |

### Implicit dependencies (enforcement)

| Flow | Minimum capability set |
|------|-------------------------|
| Migration apply loop | `migration:plan`, `backup:read`, `backup:ensure_verified`, `migration:apply` (preflight uses `backup:read`) |
| Readonly query | `query:readonly` only |
| Read-only agent | `project:read`, `schema:read`, `backup:read`, `activity:read` (typical) |

**MCP server:** optional client-side pre-check before HTTP (clear `403` summary); **server is authoritative** on CLI routes.

### Presets (dashboard UX, not stored)

| Preset name | Capabilities | Default expiry |
|-------------|--------------|----------------|
| **Read-only observer** | `project:read`, `schema:read`, `backup:read`, `activity:read` | 30 days (max 90) |
| **Migration agent** | observer + `migration:plan`, `backup:ensure_verified`, `migration:apply` | 7 days (max 30) |
| **Query analyst** | `project:read`, `schema:read`, `query:readonly` | 30 days (max 90) |
| **Intent auditor** | `project:read`, `intent:read` | 30 days (max 90) |

---

## 6. Auth flow

```text
┌─────────────┐     create (session)      ┌──────────────────┐
│  Dashboard  │ ────────────────────────► │ flux_mcp_tokens  │
│  Settings   │ ◄── token shown once ──── │ (hash only)      │
└─────────────┘                           └──────────────────┘
       │
       │ operator copies token
       ▼
┌─────────────┐   FLUX_MCP_TOKEN=flx_mcp_…   ┌─────────────┐
│ MCP server  │ ─── Bearer on CLI API ──────► │ /api/cli/*  │
│ (stdio)     │                               │ auth layer  │
└─────────────┘                               └──────┬──────┘
       │                                              │
       │ stderr audit + POST audit/intents              │ resolve userId,
       ▼                                              │ keyId, capabilities,
  keyId in payload                                    │ projectIds, expiry
                                                      ▼
                                               route handler
                                               (scope + capability)
```

1. **Dashboard creates token** — session auth; user picks name, projects, capabilities, expiry; server generates token, stores hash, returns plaintext once.
2. **Token shown once** — modal / copy field; no re-fetch of secret.
3. **MCP server** reads `FLUX_MCP_TOKEN` first, then (deprecated) `FLUX_API_TOKEN` / `~/.flux/config.json` with warning.
4. **CLI API authenticates** — `authenticateMcpToken(db, bearer)` parallel to `authenticateCliApiKey`; returns `McpAuthResult`:
   ```typescript
   { userId, keyId, capabilities: string[], projectIds: string[], tokenFamily: "mcp" }
   ```
5. **Routes enforce** project membership (hash → id ∈ `projectIds`) and required capability for the operation.
6. **Audit / intents** — populate existing `keyId` column with MCP token `id`; add `metadata.authFamily: "mcp"` and `metadata.keyPreview` (safe); never store bearer token.

### MCP token route allowlist (strict)

`flx_mcp_` tokens must **not** authenticate to full-CLI-only routes — **even when broadly scoped**. That is the whole point of a separate token family. New routes are deny-by-default for MCP tokens unless explicitly allowlisted in Slice C.

| Blocked for MCP tokens (non-exhaustive) | Reason |
|---------------------------------------|--------|
| `POST /api/cli/v1/create`, `init` | Project provisioning |
| `POST /api/cli/v1/migrate` | Engine migration / destructive lifecycle |
| `DELETE …/projects/:hash` | Project delete |
| `…/lifecycle` destructive actions | Nuke, factory reset, restore |
| `…/backups/:id/download` | Exfiltration path |
| `…/dump`, raw ad-hoc push | Bypass plan gate |

Implementation: `assertMcpTokenAllowedRoute(path, method)` immediately after auth when `tokenFamily === "mcp"`.

---

## 7. Backward compatibility

| Audience | Behavior |
|----------|----------|
| **CLI (`flux` command)** | Unchanged; only `flx_live_` (+ session flows). `flx_mcp_` rejected at CLI auth with clear error: "MCP tokens cannot be used with the Flux CLI." |
| **MCP + `flx_live_`** | **Temporary:** accept `flx_live_` when `FLUX_MCP_TOKEN` unset; emit stderr warning on every MCP process start and once per tool batch: `[flux-mcp] warning: FLUX_API_TOKEN is a broad CLI key; create a scoped FLUX_MCP_TOKEN in Settings → MCP tokens.` |
| **Deprecation path** | Phase 5.0: both families. **90-day `flx_live_` MCP deprecation clock starts only after:** (1) `flx_mcp_` creation UI ships, (2) docs + Cursor config examples land, (3) hosted deployment is live. Then T+90: `flx_live_` for MCP requires `FLUX_MCP_ALLOW_LEGACY_CLI_TOKEN=1`. Phase 6: reject `flx_live_` on MCP-facing routes entirely. |
| **Existing keys** | No migration of `flux_api_keys`; operators create MCP tokens separately. |

---

## 8. API routes

### Dashboard (session auth)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/agent/mcp-tokens` | Create token; response includes one-time `token`. |
| `GET` | `/api/agent/mcp-tokens` | List tokens (id, name, keyPreview, projectIds, capabilities, expiresAt, revokedAt, lastUsedAt) — **no secret**. |
| `POST` | `/api/agent/mcp-tokens/:id/revoke` | Set `revokedAt`. |
| `DELETE` | `/api/agent/mcp-tokens/:id` | Optional hard delete after revoke (mirror CLI keys vault). |

Server actions may wrap these from `settings/mcp-tokens/` (new page or tab under Settings).

### CLI / MCP (Bearer auth)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/cli/v1/auth/verify` | Extend: if `flx_mcp_`, return `{ ok, tokenFamily: "mcp", capabilities, projectHashes, expiresAt, keyPreview }`; if `flx_live_`, existing profile shape unchanged. |
| *(all MCP-facing routes)* | existing paths | Accept `flx_mcp_` via shared `authenticateControlPlaneBearer()` that dispatches by prefix. |

### Optional: rotate

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/agent/mcp-tokens/:id/rotate` | Revoke old row, create new row with same name/projects/capabilities/new expiry; return new token once. Defer to Slice D if scope pressure. |

---

## 9. MCP behavior changes

| Area | Change |
|------|--------|
| **Env resolution** | `packages/mcp/src/client.ts` + `@flux/cli/api-client` config: `FLUX_MCP_TOKEN` → `FLUX_API_TOKEN` → `~/.flux/config.json`. |
| **Startup warning** | No token → existing warning. Legacy CLI token → broad-key warning. Expired MCP token → fail at first API call with `not_authenticated` remediation. |
| **Tool registration** | Unchanged — all tools still listed; policy in `policy.ts` unchanged. |
| **Per-tool capability checks** | Add `assertMcpCapability(toolName, auth)` in `server.ts` before handler execution when `auth.tokenFamily === "mcp"`. Returns structured `fail(..., { remediation: "Create a token with capability X in Settings → MCP tokens." })`. |
| **ApiClient** | No separate client; same `Authorization: Bearer` header. Verify endpoint can cache capabilities in memory for the process lifetime (refresh on 401). |

---

## 10. Dashboard UI scope

**Minimal** — no settings redesign.

### New: Settings → MCP tokens (or subsection on `/settings/keys`)

- **List:** name, `keyPreview`, projects (slug chips), capability badges, expires, last used, revoked state.
- **Create form:** name, multi-select projects (from user's fleet), capability checkboxes or preset dropdown, expiry pre-filled from tier (read-only default 30d / max 90d; mutation default 7d / max 30d).
- **Create success:** one-time copy modal; dismiss clears plaintext from React state.
- **Revoke:** confirm dialog; no undo.

### Copy guidelines

- "MCP tokens grant agents access only to selected projects and capabilities. They cannot create projects or run destructive CLI commands."
- "This token is shown once. Store it in `FLUX_MCP_TOKEN` for your MCP server config."
- "Prefer short expiry; revoke immediately if leaked."

### Agent Activity

- Show `keyPreview` and link to token row when `keyId` references `flux_mcp_tokens` (join optional; fallback to raw `keyId`).

---

## 11. Tests

| Area | Cases |
|------|--------|
| **Token hashing** | `generateFluxMcpToken()` shape; checksum validation; `hashFluxMcpTokenSecret` matches auth lookup. |
| **Shown once** | Create API returns `token`; subsequent GET list omits it; DB has only hash. |
| **Revoked** | `revokedAt` set → `authenticateMcpToken` returns null → 401. |
| **Expired** | `expiresAt` in past → 401 with `error: "token_expired"`. |
| **Project scope** | Token scoped to project A → `flux.project.describe` with hash B → 403; list returns only A. |
| **Capability scope** | Token without `migration:apply` → `POST push` / apply tool → 403; without `query:readonly` → temp credential denied. |
| **Audit key id** | MCP audit POST stores `keyId` = MCP token UUID; `metadata.keyPreview` present. |
| **MCP tool denied** | Server unit test: tool call with mock auth missing capability → `ok: false`, stable error code `unauthorized`. |
| **No leakage** | `mcp-secret-scan` rejects `flx_mcp_<full>` in intent/audit payloads; stderr audit redacts bearer; route tests assert 401 body has no hash input. |
| **CLI rejection** | `flx_mcp_` on `flux push` from CLI → 401/403 with helpful message. |
| **Legacy MCP** | `flx_live_` still works for MCP routes with warning flag in test stderr capture. |
| **Allowlist** | `flx_mcp_` on `POST /api/cli/v1/create` → 403 `mcp_token_route_forbidden`. |

---

## 12. Migration plan

1. **Additive schema** — `CREATE TABLE IF NOT EXISTS flux_mcp_tokens` in system DB bootstrap; Drizzle schema in `apps/dashboard/src/db/schema.ts`.
2. **No destructive changes** — `flux_api_keys`, `mcp_audit_events`, `mcp_intents` unchanged (nullable `keyId` already exists).
3. **Secret scan** — add `FLX_MCP_KEY_RE` to `mcp-secret-scan.ts` and MCP stderr redaction.
4. **Deploy order** — ship DB + auth + routes before dashboard UI and MCP env preference (auth can exist unused).
5. **Rollback** — drop table only if no rows; otherwise leave table and disable MCP token auth via feature flag `FLUX_MCP_TOKENS_ENABLED` (default true after bake-in).

---

## 13. Rollout plan

| Step | Action |
|------|--------|
| 1 | Deploy control plane with dual auth (`flx_live_` + `flx_mcp_`). |
| 2 | Ship dashboard MCP token UI. |
| 3 | Update `packages/mcp/README.md`, `docs/AGENT_NATIVE_FLUX.md`, `docs/pages/reference/env-vars.md` with `FLUX_MCP_TOKEN`. |
| 4 | Update Cursor registration example to use `FLUX_MCP_TOKEN`. |
| 5 | Phase 4 smoke: document optional dedicated **fixture MCP token** with migration preset (still `--hash` / `--slug` / `--yes-apply-smoke-migration`). |
| 6 | Announce deprecation timeline for `FLUX_API_TOKEN` in MCP configs. |

### Local MCP config example (target)

```json
{
  "mcpServers": {
    "flux": {
      "command": "node",
      "args": ["/absolute/path/to/flux/packages/mcp/dist/index.cjs"],
      "env": {
        "FLUX_MCP_TOKEN": "flx_mcp_…",
        "FLUX_API_BASE": "https://dashboard.example.com"
      }
    }
  }
}
```

---

## 14. Non-goals

Phase 5 explicitly **does not** include:

- Streamable HTTP MCP transport
- OAuth / device code flow for agents
- Org / team RBAC or token sharing across users
- Dashboard approval / deny UI for intents
- Destructive lifecycle MCP tools (nuke, factory reset, restore, db-reset, project delete)
- **`mcp_token:manage`** or any MCP/CLI capability to create/revoke tokens (dashboard session only)
- Automatic token rotation or renewal reminders (optional later)
- Per-IP or per-agent binding (metadata hook only)
- Gateway / tenant API JWT changes (control plane only)

---

## 15. Implementation checklist

Recommended slices (one focused commit each when possible):

### Slice A — Schema + token cryptography ✅

**Shipped.** No runtime behavior change — table and helpers only.

- [x] `flux_mcp_tokens` bootstrap + Drizzle schema (`apps/dashboard/src/db/schema.ts`)
- [x] `mcp-token-auth.ts` — `generateMcpToken`, `parseMcpToken`, `hashMcpToken`, `previewMcpToken`, `isMcpTokenLike`
- [x] `mcp-capabilities.ts` — nine capabilities, expiry tiers, validation helpers
- [x] Unit tests: `mcp-token-auth.test.ts`, `mcp-capabilities.test.ts`, bootstrap idempotency
- [x] **Not in Slice A:** auth, routes, MCP env, dashboard UI, enforcement

### Slice B — Authenticate + verify + route enforcement ✅

**Shipped.** Server-side MCP auth on CLI routes; MCP runtime still uses `FLUX_API_TOKEN` only.

- [x] `authenticateMcpToken` + `authenticateControlPlaneBearer` (`mcp-token-authenticate.ts`, `control-plane-auth.ts`)
- [x] `authorizeCliRoute`, `authorizeCliHttpRequest`, route allowlist (`mcp-route-auth.ts`)
- [x] `assertMcpCapability`, `assertMcpProjectScope`, `enforceControlPlaneProjectScope`
- [x] Extend `GET /api/cli/v1/auth/verify` for MCP profile (`tokenFamily: "mcp"`)
- [x] Wire MCP allowlist + scope into `/api/cli/v1/*` routes (CLI `flx_live_` unchanged)
- [x] `GET /api/cli/v1/list` filters projects for MCP tokens
- [x] Unit tests: `mcp-token-authenticate.test.ts`, `mcp-route-auth.test.ts`
- [x] **Not in Slice B:** dashboard token UI, `FLUX_MCP_TOKEN` in MCP server, deprecation warnings, `mcp-secret-scan` `flx_mcp_` pattern

#### Authentication context (`ControlPlaneAuth`)

```typescript
// CLI (unchanged power)
{ keyType: "cli"; userId: string; keyId: string }

// MCP (scoped)
{
  keyType: "mcp";
  userId: string;
  keyId: string;           // row UUID → audit/intent keyId
  embeddedKeyId: string;   // token body segment (flux_mcp_tokens.key_id)
  keyPreview: string;
  projectIds: string[];
  capabilities: McpCapability[];
  expiresAt: Date;
}
```

Entry points: `authenticateMcpToken`, `authenticateControlPlaneBearer`, `authorizeCliRoute`, `authorizeCliHttpRequest`.

#### Route allowlist (MCP tokens)

Allowed routes map to capabilities via `classifyMcpCliRoute` in `mcp-route-auth.ts`. Examples:

| Route pattern | Capability |
|---------------|------------|
| `GET /api/cli/v1/list` | `project:read` (response filtered to `projectIds`) |
| `GET /api/cli/v1/auth/verify` | `authenticated` (MCP profile JSON) |
| `POST /api/cli/v1/audit`, `POST/PATCH /api/cli/v1/intents*` | `authenticated` + project scope in body when set |
| `POST /api/cli/v1/push` | `migration:apply` + project scope from body hash |
| `GET …/metadata`, `…/doctor`, `…/flux-md` | `project:read` |
| `POST …/schema-inspection`, `GET …/migrations` | `schema:read` |
| `GET …/backups` | `backup:read` |
| `POST …/backups`, `POST …/backups/:id/verify` | `backup:ensure_verified` |
| `GET …/db-access`, `POST …/temporary-credential`, `POST …/query` | `query:readonly` |
| `GET …/activity` | `activity:read` |
| `GET /api/cli/v1/intents` | `intent:read` |

**Forbidden for all MCP tokens** (403 `mcp_token_route_forbidden`): `create`, `init`, `migrate`, `logs`, `codex`, project `DELETE`, lifecycle mutations, `dump`, `api-env`, `credentials`, backup `download`, metadata/flux-md writes, `ai/summary`.

`flx_live_` CLI keys bypass MCP allowlist (full CLI power preserved).

### Slice C — Dashboard MCP token API ✅

**Shipped.** Session-authenticated create/list/revoke routes; plaintext shown once on create only.

- [x] `POST /api/agent/mcp-tokens` — create scoped token (`{ token, tokenRecord }`)
- [x] `GET /api/agent/mcp-tokens` — list safe fields (`{ tokens: [...] }`)
- [x] `DELETE /api/agent/mcp-tokens/:id` — soft revoke (`{ ok: true }`)
- [x] Lib: `createMcpTokenForUser`, `listMcpTokensForUser`, `revokeMcpTokenForUser`
- [x] Sanitizer: `sanitizeMcpTokenRow`, `mcpTokenListResponseContainsSecret` (`mcp-token-sanitize.ts`)
- [x] Expiry tiers enforced on create (read-only 30d default / 90d max; mutation 7d / 30d)
- [x] Unit tests: `mcp-agent-mcp-tokens-routes.test.ts`
- [x] **Not in Slice C:** dashboard UI, `FLUX_MCP_TOKEN` MCP env switch, `flx_live_` deprecation, `mcp-secret-scan` `flx_mcp_` pattern

#### Route shapes (session auth)

**POST `/api/agent/mcp-tokens`**

Request body:

```json
{
  "name": "optional label",
  "projectIds": ["<project-uuid>"],
  "capabilities": ["project:read", "schema:read"],
  "expiresAt": "optional ISO-8601",
  "metadata": { "optional": "object" }
}
```

Response `201`:

```json
{
  "token": "flx_mcp_…",
  "tokenRecord": {
    "id": "uuid",
    "keyId": "12-hex",
    "keyPreview": "flx_mcp_abcd…wxyz",
    "name": "optional label",
    "projectIds": ["…"],
    "capabilities": ["…"],
    "expiresAt": "ISO-8601",
    "revokedAt": null,
    "createdAt": "ISO-8601",
    "lastUsedAt": null,
    "metadata": {}
  }
}
```

Plaintext `token` is returned **only** in this response. DB stores `key_hash` only.

**GET `/api/agent/mcp-tokens`**

Response `200`:

```json
{ "tokens": [ /* same safe fields as tokenRecord; no token, no keyHash */ ] }
```

Newest first. `name` is surfaced from `metadata.name` when present.

**DELETE `/api/agent/mcp-tokens/:id`**

Response `200`: `{ "ok": true }`. Sets `revokedAt`; row is retained. Idempotent when already revoked. Owner-scoped (404 for other users).

### Slice D — Dashboard UI ✅

**Shipped.** Minimal settings UI at `/settings/mcp-tokens` for create, list, revoke, and one-time plaintext display.

- [x] Page at `/settings/mcp-tokens` (session auth; unauthenticated → sign-in redirect)
- [x] List: name, keyPreview, capabilities, project labels/count, expires/revoked/last-used/created, status (active/expired/revoked)
- [x] Create form: name, project multi-select, capability multi-select, expiry selector, mutation-capable warning
- [x] One-time plaintext copy box after create (in-memory only; dismiss clears)
- [x] Revoke with confirmation → `DELETE /api/agent/mcp-tokens/:id`
- [x] Safety copy: `FLUX_MCP_TOKEN` coming in Slice E; MCP still uses `FLUX_API_TOKEN` today
- [x] Cross-links from `/settings/keys`
- [x] Tests: `mcp-tokens-page.test.ts` (auth redirect, list rows, form validation, mutation warning, create-once, list safety, revoke URL/state, status, secret scan)
- [x] **Not in Slice D:** `FLUX_MCP_TOKEN` MCP env switch (Slice E), `flx_live_` deprecation, streamable HTTP

#### UI route

`/settings/mcp-tokens` — session-authenticated dashboard page. Uses Slice C APIs:

- Initial list: server-side `listMcpTokensForUser`
- Create: `POST /api/agent/mcp-tokens` (browser `fetch`, cookies)
- Revoke: `DELETE /api/agent/mcp-tokens/:id`

Plaintext token lives only in React component state until dismissed; never in list payloads, URLs, or storage.

### Slice E — MCP server `FLUX_MCP_TOKEN` ✅

**Shipped.** MCP runtime prefers scoped tokens; legacy CLI sources work with stderr warning.

- [x] `resolveMcpServerToken()` + `getMcpApiClient()` in `@flux/cli/api-client` (`mcp-auth.ts`)
- [x] Resolution order: `FLUX_MCP_TOKEN` → `FLUX_API_TOKEN` → `~/.flux/config.json`
- [x] `FLUX_MCP_TOKEN` must be valid `flx_mcp_…` (startup error if not)
- [x] Legacy `FLUX_API_TOKEN` / config file → stderr warning (not stdout); no token in warning text
- [x] `bootstrapMcpAuth()` in `packages/mcp/src/auth.ts` + `packages/mcp/src/index.ts`
- [x] CLI `resolveFluxApiToken()` unchanged (CLI behavior preserved)
- [x] Tests: `mcp-auth.test.ts`, `auth.test.ts`
- [x] Docs: `packages/mcp/README.md`, `docs/AGENT_NATIVE_FLUX.md`
- [x] **Not in Slice E:** formal `flx_live_` deprecation clock, per-tool MCP `server.ts` capability checks beyond Slice B route enforcement, startup `/auth/verify` network call

#### Auth resolution (MCP process only)

| Priority | Source | Behavior |
|----------|--------|----------|
| 1 | `FLUX_MCP_TOKEN` | Required `flx_mcp_…` format; fatal on invalid |
| 2 | `FLUX_API_TOKEN` | Allowed; stderr legacy warning |
| 3 | `~/.flux/config.json` | Allowed; stderr legacy warning |

Warnings go to **stderr only** (stdout is the MCP stream).

### Slice F — Audit + redaction + MCP capability guard

- [x] Ensure `keyId` + `keyPreview` on all MCP audit/intent writes for MCP tokens (`mergeControlPlaneAuthMetadata`)
- [x] `flx_mcp_` patterns in `mcp-secret-scan.ts`, MCP stderr audit, intent sanitizer
- [x] MCP-side `assertMcpToolCapabilityAllowed` before tool handlers when `FLUX_MCP_TOKEN` is set (verify profile cached from `/api/cli/v1/auth/verify`)
- [x] Safe denial messages (tool, capability, `/settings/mcp-tokens` remediation; no token leakage)
- [x] Tests: secret scan, enrichment, capability allow/deny, legacy path, no leakage
- [x] **Not in Slice F:** formal `flx_live_` deprecation clock (Slice G), streamable HTTP, new MCP tools

### Slice G — Docs + rollout

- [x] `packages/mcp/README.md` — `FLUX_MCP_TOKEN` default, capability presets, Cursor examples (prod + `pnpm start`), legacy deprecation notice
- [x] `docs/AGENT_NATIVE_FLUX.md`, `docs/pages/reference/env-vars.md` (`FLUX_MCP_TOKEN`)
- [x] Dashboard `/settings/mcp-tokens` copy — `FLUX_MCP_TOKEN`, once-only plaintext, avoid broad API keys, shorter mutation expiry
- [x] `legacyCliTokenForMcp: supported_with_warning` in `@flux/cli/api-client` (`mcp-deprecation.ts`)
- [x] Tests: docs/examples secret scan, legacy warning does not imply immediate removal, dashboard copy mentions `FLUX_MCP_TOKEN`
- [x] **Not in Slice G:** remove `FLUX_API_TOKEN` support, hard removal date, streamable HTTP, token rotate endpoint

**Phase 5 complete.** Optional future work (Slice H+):

- Token rotate endpoint
- Agent Activity join to show MCP token name
- Streamable HTTP transport
- Formal `FLUX_API_TOKEN`-for-MCP removal date (after deprecation countdown)

**After each slice:** `pnpm check:architecture`, `pnpm typecheck`, `pnpm test`.

---

## 16. Suggested first implementation prompt

**Phase 5 is complete.** Optional follow-ups: token rotate, Agent Activity token-name join, streamable HTTP, formal legacy MCP token removal date.

### Slice G prompt (completed)

> **Flux MCP Phase 5 — Slice G: Docs + rollout**
>
> Read `plans/mcp/phase-5-scoped-mcp-tokens.md` (Slice G). Update env-var docs, Cursor examples, capability presets, dashboard copy, and start the non-breaking `flx_live_` deprecation notice for MCP config.

### Slice F prompt (completed)

> **Flux MCP Phase 5 — Slice F: Audit + redaction**
>
> Read `plans/mcp/phase-5-scoped-mcp-tokens.md` (Slice F). Add `flx_mcp_` to secret scan; ensure MCP audit/intent rows use keyPreview for MCP tokens; add MCP-side capability defense-in-depth.

### Slice E prompt (completed)

> **Flux MCP Phase 5 — Slice E: MCP server `FLUX_MCP_TOKEN`**
>
> Read `plans/mcp/phase-5-scoped-mcp-tokens.md` (Slice E). Wire MCP runtime to prefer `FLUX_MCP_TOKEN` with legacy `FLUX_API_TOKEN` warnings.

### Slice D prompt (completed)

> **Flux MCP Phase 5 — Slice D: Dashboard MCP token UI**
>
> Read `plans/mcp/phase-5-scoped-mcp-tokens.md` (Slice D). Build settings UI on top of Slice C API routes.
>
> No `FLUX_MCP_TOKEN` MCP env switch yet (Slice E).

### Slice C prompt (completed)

> **Flux MCP Phase 5 — Slice C: Dashboard MCP token CRUD API**
>
> Read `plans/mcp/phase-5-scoped-mcp-tokens.md` (Slice C). Implement session-authenticated `POST/GET /api/agent/mcp-tokens` and revoke, using existing crypto + validation helpers.
>
> No `FLUX_MCP_TOKEN` MCP env switch yet (Slice E). No dashboard UI (Slice D).

### Slice B prompt (completed)

> **Flux MCP Phase 5 — Slice B: MCP token authentication**
>
> Read `plans/mcp/phase-5-scoped-mcp-tokens.md` (Slice B only). Build on `mcp-token-auth.ts` and `flux_mcp_tokens`.
>
> Implement `authenticateMcpToken`, `authenticateControlPlaneBearer`, extend `GET /api/cli/v1/auth/verify` for MCP profile. Reject `flx_mcp_` from CLI-only routes used by the `flux` binary.
>
> No dashboard UI, no MCP `FLUX_MCP_TOKEN` env yet, no route capability enforcement (Slice C).
>
> Run: `pnpm typecheck`, `pnpm test`, `pnpm check:architecture`.

### Slice A prompt (completed)

> **Flux MCP Phase 5 — Slice A: MCP token schema and cryptography**
>
> Read `plans/mcp/phase-5-scoped-mcp-tokens.md` (Sections 3–4, Slice A only).
>
> Add additive `flux_mcp_tokens` table to system DB bootstrap and Drizzle schema (`apps/dashboard/src/db/schema.ts`). Implement `flx_mcp_` token generation, checksum validation, and SHA-256 hashing — mirror the patterns in `apps/dashboard/src/lib/cli-api-auth.ts` but in a dedicated `mcp-token-auth.ts` module.
>
> Columns: id, userId, keyHash, keyPreview, name, projectIds (uuid[]), capabilities (text[]), expiresAt, revokedAt, createdAt, lastUsedAt, metadata.
>
> No API routes, no MCP changes, no dashboard UI in this slice.
>
> Tests: token format, checksum rejection, hash stability, bootstrap idempotency.
> Run: `pnpm typecheck`, dashboard unit tests.
>
> Commit: `feat(dashboard): add flux_mcp_tokens schema and token crypto`

---

## References

- CLI key auth: `apps/dashboard/src/lib/cli-api-auth.ts`
- MCP tools: `packages/mcp/src/tools/index.ts`
- MCP policy: `packages/mcp/src/policy.ts`
- Audit/intent schema: `apps/dashboard/src/db/schema.ts` (`mcpAuditEvents`, `mcpIntents`)
- Secret scan: `apps/dashboard/src/lib/mcp-secret-scan.ts`
- Phase 4B plan: `plans/mcp/phase-4b-apply-hardening.md`
- Agent-native milestones: `docs/AGENT_NATIVE_FLUX.md`
- MCP README: `packages/mcp/README.md`
