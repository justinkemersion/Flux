# Per-project bot User-Agent filter

**Status:** Deferred (no current customer pull). Pick up when a project actually
asks to customise UA filtering.

**Author context:** Drafted 2026-05-08, immediately after shipping the
gateway-wide static-asset absorber and the opt-in platform-level UA denylist
(`FLUX_GATEWAY_BLOCK_BOT_USER_AGENTS` / `FLUX_GATEWAY_BOT_UA_PATTERN`). See
[`packages/gateway/src/static-asset-filter.ts`](../../packages/gateway/src/static-asset-filter.ts)
and [`packages/gateway/src/bot-filter.ts`](../../packages/gateway/src/bot-filter.ts).

---

## Why this is deferred

- The static-asset / scanner-path absorber already absorbs the **noisy** bot
  traffic (`/robots.txt`, `/favicon.ico`, `/.well-known/*`, `/wp-admin`,
  `/bot-connect.js`, …) before tenant resolution, with no DB hit. That solved
  the original Bloom log-pollution problem for every project, with zero risk
  to legitimate API clients.
- The platform-level UA denylist is opt-in (default off), conservative
  (`MJ12bot|AhrefsBot|SemrushBot|PetalBot|DotBot|YandexBot|nikto|sqlmap|wpscan|masscan|nmap|Nuclei|zgrab`),
  and does not touch real client UAs (`curl`, `axios`, `Go-http-client`,
  `python-requests`, `node-fetch`, `Bun`, `Deno`, browsers).
- No customer has actually asked to customise UA filtering per project yet.
  Shipping a half-finished UI surface (settings panel, audit log, validation,
  CLI) without a real pull is the wrong order of work.

If a customer asks ("I want my project to also block Bingbot but allow
Googlebot"), this plan is ready to execute.

---

## What "per-project env" actually means

There are two unrelated "envs" in Flux today; per-project UA filtering does
**not** belong to the second one:

1. **Gateway `.env`** — process env read once at startup by the gateway
   container. Applies to every tenant the gateway routes for. This is where
   the platform-level filter lives today.
2. **Project env** ([`listProjectEnv`](../../packages/core/src/index.ts) and
   `flux env list`) — the **PostgREST container's** environment, read from
   `Config.Env` via `dockerode`. Only meaningful for `v1_dedicated` stacks
   that have their own PostgREST container. For `v2_shared` (Bloom's mode)
   there is no per-project container — they share one pooled PostgREST.

The gateway never reads PostgREST container envs (it can't; the gateway is a
separate process). So per-project UA filtering must live where the gateway
already looks during tenant resolution: the **`projects` row in flux-system**.

---

## Plan

### 1. Schema — `apps/dashboard/src/lib/db/index.ts`

Add one nullable column, idempotently, in the same `ALTER TABLE projects`
block as `jwt_secret`, `migration_status`, `api_schema_name`:

```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bot_ua_pattern TEXT;
```

Constraints to enforce at write time (not as a `CHECK` — Postgres has no
regex-validity check):

- length cap: 1024 chars (defence against pathological patterns)
- must compile via `new RegExp(value, "i")`
- must compile in <5 ms on a representative input (defence against
  catastrophic backtracking like `(a+)+$`)

### 2. Tenant resolution — `packages/gateway/src/tenant-resolver.ts`

Add the column to both DB queries:

- [`queryByExactDomain`](../../packages/gateway/src/tenant-resolver.ts) — the SELECT
  joining `domains` and `projects`.
- [`queryBySlugAndHash`](../../packages/gateway/src/tenant-resolver.ts) — the
  slug+hash lookup against `projects`.

Add `botUaPattern: string | null` to:

- [`TenantResolution`](../../packages/gateway/src/types.ts)
- The Redis cache `tenantResolutionSchema` (Zod)
- `toResolution()`'s arguments + return shape

The 60s memory + Redis cache TTL already in place is the right caching
behaviour for this — operators rarely change UA policy more than once a day,
and the existing `evictHostname()` invalidation (called from domain CRUD)
extends naturally to project-settings updates.

### 3. Filter wiring — `packages/gateway/src/app.ts` + `bot-filter.ts`

Move the filter check from a global `app.use("*", botFilterMiddleware(…))`
to a per-request check **inside** the catchall, immediately after
`resolveTenant()` returns:

```ts
// Pseudo-code; expand the existing app.all("*", …) handler.
const tenant = resolved.resolution;
const blocked = shouldBlockUserAgent({
  ua: c.req.header("user-agent") ?? "",
  platformPattern: env.FLUX_GATEWAY_BOT_UA_PATTERN,
  platformEnabled: env.FLUX_GATEWAY_BLOCK_BOT_USER_AGENTS,
  projectPattern: tenant.botUaPattern,
});
if (blocked) {
  log({ /* … */, status: 403, /* … */ });
  return c.json({ error: "forbidden" }, 403);
}
```

**Layering rule (additive, not override):**

- The platform-level pattern (today's `FLUX_GATEWAY_BOT_UA_PATTERN`) is
  always evaluated when `FLUX_GATEWAY_BLOCK_BOT_USER_AGENTS=1`.
- The project-level pattern is OR'd on top — Sarah can **add** to the
  platform list, but cannot subtract from it.
- The platform-level off switch (`=0`) does not disable per-project filters.
  Per-project filters are always evaluated when set.

This prevents a customer from accidentally widening their own attack
surface below the platform baseline, while still letting them harden their
specific project against bots that are not platform-wide problems.

**Compilation cache:** compile each tenant's regex **once per resolution**
and stash it on the cached `TenantResolution` object (or in a parallel
`Map<tenantId, RegExp>` keyed by `(tenantId, pattern)`). Do NOT recompile on
every request. Invalidate the compiled regex when `evictHostname()` runs.

**Failure mode:** if a project's pattern fails to compile (already
prevented at write time, but defensive), log an error and treat the project
as if it had no per-project pattern — the platform default still applies.

### 4. Operator UX

Two surfaces, in priority order:

**a) Dashboard — Project Settings → Security panel** (`apps/dashboard/`)

- Single text input: "Block requests with User-Agent matching"
- Helper text: "Regex (case-insensitive). Examples: `MJ12bot|AhrefsBot`."
- Server-side validation: length cap, regex compile, pathological-pattern
  test against a fixed corpus.
- On save: write to `projects.bot_ua_pattern`, then call the existing
  hostname-eviction path so the gateway picks up the change within 60 s.
- Audit log entry: `project.security.bot_ua_pattern.updated`.

**b) CLI — `flux project set --bot-ua-pattern <regex>`** (`packages/cli/`)

- New `flux project set` subcommand on the project. Mirrors the dashboard
  validation. Useful for CI / scripted setup.
- Sets the column directly via the existing `@flux/core` SDK.

Either surface invalidates the cache via the same path that domain CRUD
already uses.

### 5. Tests

- Unit: `bot-filter.test.ts` — extend with cases for "platform off + project
  set blocks", "platform on + project adds extra UAs", "project pattern is
  not allowed to bypass platform pattern".
- Unit: `tenant-resolver.test.ts` — assert `botUaPattern` survives the
  Redis cache round-trip and is `null` for legacy rows.
- Integration: `app.ts` flow test that with platform off + project pattern
  set, a matching UA is blocked AND no DB query runs after tenant resolution
  (mock the proxy + assert).
- Validation: schema column write rejects regex >1024 chars, invalid regex,
  and a pathological backtracking pattern (canary).

### 6. Docs

- [`packages/gateway/README.md`](../../packages/gateway/README.md) — extend
  the bot-filter section with the layered platform + project-level model.
- [`AGENTS.md`](../../AGENTS.md) — add a note under the "v2_shared" section
  explaining how a project owner enables per-project UA filtering and the
  60 s cache window for changes to take effect.
- Dashboard help link from the new Security panel to the README section.

---

## Acceptance criteria

1. Sarah can set `bot_ua_pattern = 'Bingbot'` on her Bloom project (via
   dashboard or CLI) and within 60 s a request with
   `User-Agent: Mozilla/5.0 (compatible; Bingbot/2.0)` returns 403 from
   her project's API host.
2. The same UA against a different project (without the pattern set) is
   served normally.
3. With `FLUX_GATEWAY_BLOCK_BOT_USER_AGENTS=1` at the gateway, the platform
   pattern still blocks `MJ12bot` for **every** project, regardless of
   per-project setting (additive layering verified).
4. A regex that takes >5 ms to compile or a string >1024 chars is rejected
   at write time with a clear error.
5. No new DB query is added to the hot path — `botUaPattern` flows through
   the existing tenant-resolution cache.
6. Existing 35 gateway tests stay green; ≥6 new tests cover the
   per-project + platform layering.

---

## Out of scope

- Allowlist mode (whitelisting UAs and rejecting everything else). Different
  shape, very different UX, no current pull.
- Per-route or per-method filtering. PostgREST is uniform across paths from
  the gateway's perspective; routing-layer filtering doesn't fit the model.
- IP-based filtering. Useful but a separate plan with separate threat model.
- Geo-IP filtering. Same.
- Rate-limit-by-UA. The existing per-tenant rate limiter is the right layer
  for this if it ever comes up.

---

## Effort estimate

About a half-day of focused work for an engineer familiar with the gateway:

- Schema + Zod + types: ~30 min
- Gateway plumbing + cache: ~1 h
- Layered filter logic + tests: ~1 h
- Dashboard panel: ~1.5 h
- CLI subcommand: ~30 min
- Docs + manual smoke test against a real tenant: ~1 h

If shipping CLI-only (no dashboard panel), shave ~1.5 h off.
