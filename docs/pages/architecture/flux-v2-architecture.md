---
title: Flux v2 architecture
description: How pooled Flux projects work — invariants, request flow, JWT contract, tenant isolation, and operational behavior.
section: architecture
---

# Flux v2 architecture

> This page explains the architecture of Flux **v2 shared** (pooled) projects. It is the deepest page in the docs.
>
> If you only want to make your first successful request, start with:
>
> - [First request](/docs/getting-started/first-request)
> - [Auth.js with Flux](/docs/guides/authjs)
> - [Next.js with Flux](/docs/guides/nextjs)
>
> Return here once you want the deeper system model — the invariants the gateway protects, what the bridge JWT actually carries, where tenant isolation begins and ends, and what Flux deliberately does not promise.

## What you will learn

- The mental model: pooled infrastructure with logically isolated tenants
- What your application sees, and what it does not (no static keys on v2)
- How a request travels from your app to a tenant schema, step by step
- Where the trust pivot is, and why one component is a security control
- The operational behavior — rate limits, scaling, PgBouncer constraints — that shapes how v2 behaves under load
- What v2 explicitly does not promise, and when [v1 dedicated](/docs/concepts/pooled-vs-dedicated) is the better fit

## 1. Mental model

Flux v2 is:

- **Pooled infrastructure** — many projects share one PostgreSQL cluster and one PostgREST pool.
- **Schema-isolated tenants** — each project owns a deterministic Postgres schema and a deterministic Postgres role; nothing in those names is derived from your slug.
- **JWT-authenticated requests** — there are no anonymous or service keys exposed on the public API. Your application sends a JWT signed with the project's secret; the Flux gateway verifies it.
- **PostgREST-backed APIs** — your tables become HTTP resources via PostgREST. The contract is HTTP and PostgreSQL, not a Flux-proprietary client SDK.
- **Operationally shared, logically isolated** — the cluster and the pool are shared. The data, the role, and the schema are not.

The whole architecture exists to make those five sentences true at the same time.

### What this page leaves for later

The first half of this page does not mention PgBouncer, Traefik, internal pool sharding, Redis cache keys, or operational scaling. Those exist and matter, but the reader who needs them will have read the mental model first. They appear from [§6 Internal architecture](#6-internal-architecture) onward.

## 2. What your app sees

Your app has three points of contact with v2:

1. **The Service URL.** A public HTTPS hostname for your project, of the form `https://api--<slug>--<hash>.<base-domain>`. This is where every request goes. See [Service URLs](/docs/concepts/service-urls).
2. **A JWT in the `Authorization` header.** Your app signs an HS256 JWT with the project's `jwt_secret` (or asks an IdP like Clerk or Auth.js to sign one with that secret). Every request carries `Authorization: Bearer <token>`. See [JWT authentication](/docs/concepts/jwt-auth).
3. **JSON in and out, via PostgREST.** Tables become resources at `/<table>`; query parameters filter, sort, and project. The shape is [PostgREST's published interface](https://postgrest.org/), not something Flux wraps.

What your app does not see:

- **No static `anon` or `service` keys** on the public internet. Pooled stacks do not expose long-lived database-equivalent secrets to browsers. The trust pivot is the gateway, not a key embedded in your bundle.
- **No PostgREST hostname.** PostgREST is not publicly reachable on v2. Only the gateway has a network path to it.
- **No internal JWT.** The token your app signs is the only one your app handles. The gateway issues a separate, short-lived **bridge JWT** for the internal hop to PostgREST; you never see it.

That last difference is the one most readers coming from other BaaS platforms get wrong. There is no anon key to leak.

## 3. Authentication flow

A complete v2 request, end to end:

```txt
Your app
  ↓ Authorization: Bearer <project JWT, HS256 with jwt_secret>
Flux gateway
  ├─ resolves Host header to a tenant_id (system DB; Redis as read-through cache)
  ├─ verifies the project JWT against the project's jwt_secret
  ├─ enforces the per-tenant rate limit (Redis, fail-open)
  └─ mints a short-lived bridge JWT { role, tenant_id, exp }
  ↓ private network only
PostgREST pool
  ├─ verifies the bridge JWT against PGRST_JWT_SECRET
  └─ SET ROLE <role from the bridge JWT> on the connection
  ↓
PgBouncer (transaction pooling)
  ↓
PostgreSQL shared cluster
  └─ search_path is t_<shortid>_api; only that schema is visible to this role
```

Three signing keys are in play:

| Signs | Key material | Held by |
|-------|---------------|---------|
| Project JWT (your app's token) | The project's `jwt_secret` (per-project, in `flux-system`) | Your app, the gateway |
| Bridge JWT (gateway → PostgREST) | The pool's `PGRST_JWT_SECRET` | The gateway, PostgREST pool |
| Admin / service tokens (control plane) | A separate signing key | Control plane only — never on the public path |

Apps sign with the per-project secret. Apps never see the pool secret. The two are deliberately separate so that compromising one tenant's secret does not let an attacker forge tokens accepted by the pool, and so that the pool can be rotated independently of every tenant.

For the security posture this implies, see [Authentication model](/docs/security/authentication-model) and [Bridge JWTs](/docs/architecture/bridge-jwts).

## 4. Tenant isolation

Every v2 project has:

- A **`tenant_id`** — a UUID, immutable, never exposed on the public path.
- A **`shortid`** — the first 12 hex characters of `tenant_id` with hyphens removed. Deterministic; immutable.
- A **schema** named `t_<shortid>_api`, e.g. `t_5ecfa3ab72d1_api`.
- A **role** named `t_<shortid>_role`, e.g. `t_5ecfa3ab72d1_role`.
- A **`search_path`** for that role set to its schema.
- **Grants** that give the role `USAGE` on its schema and table privileges only there.

The slug — the human-readable name shown in the dashboard and in the Service URL — is **never** embedded in a schema or role name. Slugs can change; identifiers must not.

### Where the math lives

Twelve hex characters is 48 bits of entropy. The probability of a `shortid` collision across 2,000 tenants on a single cluster is roughly `2000² / 2 × 2^48 ≈ 1.4 × 10⁻⁹`. The full identifier `t_<12 hex>_api` is 18 bytes — well inside PostgreSQL's 63-byte limit.

```txt
tenant_id  = "5ecfa3ab-72d1-4b2a-9a1d-0f1e2d3c4b5a"
uuid_hex   = "5ecfa3ab72d14b2a9a1d0f1e2d3c4b5a"
shortid    = "5ecfa3ab72d1"                      first 12 hex chars
schema     = "t_5ecfa3ab72d1_api"
role       = "t_5ecfa3ab72d1_role"
```

### What you are protected from on v2

- **Cross-tenant SQL access.** A request that arrives with one tenant's bridge JWT cannot read another tenant's tables. The role's `USAGE` and `SELECT` grants exist only on its own schema.
- **Slug-based collisions.** Renaming a project does not move data. Schema names trace to the immutable `tenant_id`, not the mutable slug.
- **Direct PostgREST access.** PostgREST is not on the public internet on v2. The only network path is through the gateway.

### What you are not protected from on v2

- **Cluster-level blast radius.** v2 deliberately accepts that a misbehaving tenant can stress the shared cluster. Operational controls (rate limits, connection caps, statement timeouts) reduce this; they do not eliminate it.
- **Hard CPU isolation.** v2 does not promise per-tenant CPU pinning. If you need that, you want [v1 dedicated](/docs/concepts/pooled-vs-dedicated).
- **RLS by default.** v2's baseline isolation is schema and role, not [row-level security](/docs/concepts/rls). RLS is an opt-in additional control your app adds; it is not the load-bearing boundary.

For the threat-model framing, see [Threat model](/docs/security/threat-model). For the structural layout, see [Tenant isolation (architecture)](/docs/architecture/tenant-isolation).

## 5. Why no static keys

Most BaaS platforms expose a static `anon` key (and sometimes a `service` key) in the browser. Flux v2 does not. This is deliberate; the alternative was considered and rejected.

A static key on the public internet is a credential. Once it is in a browser bundle, every reader has it; rotating it breaks every deployed client; and the role it grants is bounded only by the policies attached to it. PostgREST and PostgreSQL can carry that model, but it concentrates the trust decision in a piece of string sitting in your repo and your CDN.

v2 moves the trust pivot to the **gateway** instead:

- The token your app sends is signed with **your project's** secret. Compromising one project's secret does not leak any other project's data.
- The token is verified server-side, on every request, by code that owns the tenant resolution. Forgery requires the project secret, not just access to network traffic.
- The role assigned downstream is chosen by the gateway from the verified token, not by a client-supplied claim PostgREST trusts blindly.
- The internal step uses a **short-lived bridge JWT** that never leaves the gateway → PostgREST hop. There is no long-lived database-equivalent credential sitting on the public internet.

This is the **no-shim policy** in concrete form: Flux fixes the capability gap (per-tenant verification at the edge) at the Flux layer, instead of asking every application to ship around an exposed key. You can still reach for [RLS](/docs/concepts/rls) when your data model needs row-by-row checks; the platform-level boundary is one layer up and does not depend on your policies being correct.

## 6. Internal architecture

This section names the parts the previous five did not. The reader who only needs to ship can stop here and come back later; the reader who needs to debug, plan capacity, or evaluate trust will want what follows.

### Control plane vs data plane

The system splits cleanly:

| Plane | What it owns | Components |
|-------|--------------|------------|
| **Control plane** | Decides what exists. Project records, tenant identifiers, secrets, schema migrations, lifecycle. Read-only from the request hot path. | `flux-system` Postgres, `apps/dashboard` (UI + API), `@flux/core` (engine registry), `@flux/cli` |
| **Data plane** | Serves application traffic. | `@flux/gateway`, PostgREST pool, PgBouncer, the shared PostgreSQL cluster, Redis (cache and best-effort telemetry) |

The control plane writes to `flux-system`. The gateway reads from it (with Redis as a read-through cache). The gateway never writes to `flux-system` and never participates in lifecycle.

### Engine abstraction

v1 dedicated and v2 shared coexist in one codebase. The choice is not a fork. A project record carries an explicit `mode` field (`v1_dedicated` or `v2_shared`); the engine registry in `@flux/core` selects the implementation by `mode`.

A canonical project row:

```json
{
  "tenant_id": "5ecfa3ab-72d1-4b2a-9a1d-0f1e2d3c4b5a",
  "slug": "bloom-atelier",
  "mode": "v2_shared",
  "plan": "free",
  "status": "active"
}
```

`mode` is always explicit. Provisioning may **default** new projects to `v2_shared`, but logic must not infer mode from `plan` alone. Changing a project's mode is an audited migration action ([Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate)), not an implicit flag flip.

Both engines share an interface — `provisionProject`, `deleteProject`, `suspendProject`, `getApiUrl`, `getCredentials`, `setEnv`, `listEnv`, `importSql`. v2 adds `createTenantSchema`, `createTenantRole`, `assignTenantMetadata`. v1 adds container and Docker-network management. The dashboard, the CLI, and the gateway depend only on the interface; neither plane needs to know which engine a project uses unless it has engine-specific work to do.

### Gateway responsibility boundary

The gateway is small on purpose. It:

- Resolves hostname → `tenant_id` (system DB; Redis as cache).
- Verifies the project JWT against the project's `jwt_secret`.
- Enforces the per-tenant rate limit; returns HTTP 429 without forwarding when the limit is exceeded.
- Mints the short-lived bridge JWT and proxies the request to a PostgREST instance on the private network.
- Best-effort `INCR activity:{tenant_id}` for activity tracking.

It does **not**:

- Hold business logic.
- Write to any database.
- Manage tenant lifecycle.
- Become a "mini control plane."

The reason for that discipline is in [§5 Why no static keys](#5-why-no-static-keys) and in the failure-boundary discussion below: the gateway is a security control. The smaller and more focused it is, the easier it is to test, audit, and reason about.

### Custom domains

Tenants can map custom hostnames onto their project. The control plane stores `(hostname → tenant_id)` rows in `flux-system.domains`; the gateway resolves a request's `Host` header against that table (with Redis caching). On domain create, update, or delete, the control plane explicitly evicts `hostname:{old_host}` from Redis — TTL expiry alone produces stale routing for the TTL window, which is the wrong default for a routing decision.

### Redis is cache and telemetry, never authoritative

| Key | Purpose | Authoritative? |
|-----|---------|----------------|
| `hostname:{host}` | Tenant resolution cache | No — `flux-system.domains` is truth on miss |
| `rate:{tenant_id}` | Per-tenant rate-limit counter | No — limit is policy; counter is best-effort |
| `activity:{tenant_id}` | Heartbeat for `last_accessed_at` flush | No — Postgres holds the durable value |

Wiping Redis must not affect data correctness. The gateway must never block on Redis; if Redis is unavailable, the gateway falls back to the database (for resolution) or fails open (for rate limiting). The non-blocking Redis pattern is a load-bearing rule in the data-plane code:

```typescript
try {
  await redis.incr(key);
} catch {
  // swallow; log a metric if needed; continue with the primary request
}
```

This applies everywhere Redis touches the request path. A Redis timeout that propagates into a request handler is a bug.

### Engine selection by tier

| Tier | Engine | Isolation | Compliance posture |
|------|--------|-----------|---------------------|
| Free | `v2_shared` | schema + role | not a compliance boundary |
| Pro | `v2_shared` | schema + role | not a compliance boundary |
| Enterprise | `v1_dedicated` | container | SOC 2 / HIPAA-ready |

Tiers map to engines, but the docs and the catalog use the engine name when precision matters. Marketing tiers can rename; the engine vocabulary is stable.

## 7. Operational behavior

This is the section that determines how v2 behaves under load and what you should expect during a busy weekend.

### Rate limiting

- **Algorithm.** Fixed window per tenant per hour.
- **Default limits.** 20 req/min on Free, 100 req/min on Pro. Configurable per project.
- **Over-limit response.** HTTP 429 from the gateway; the request is **not** forwarded to PostgREST.
- **Redis unavailable.** Default is **fail-open** — allow the request, log a metric. Availability over strict enforcement during cache outages. A future Pro+ option may opt into fail-closed or hybrid enforcement; the default does not.

### Activity tracking is lossy by design

The system needs to know whether a tenant was active in the last few minutes; it does not need exact per-request timestamps. Each request does a best-effort `INCR activity:{tenant_id}` with a 60-second TTL; a flush worker every 30–60 seconds reads the active set and updates `projects.last_accessed_at`. Redis loss costs at most one window of activity; Postgres remains the durable record.

The downstream consumer is the idle-reaping job (`reapIdleProjects`), which suspends or reclaims resources from projects inactive for a configured threshold. That feeds cost control on the shared tier.

### PgBouncer transaction pooling — what it breaks

PostgREST connects through PgBouncer in **transaction pooling mode**. A given Postgres backend is held only for the duration of a single transaction, then returned to the pool. Some Postgres patterns assume session continuity and break:

| Pattern | Broken by transaction pooling? |
|---------|-------------------------------|
| `CREATE TEMP TABLE` across requests | yes |
| Advisory locks across requests | yes |
| `SET` / `SET LOCAL` persisting beyond a transaction | yes |
| Named prepared statements | yes — use unnamed |
| `LISTEN` / `NOTIFY` | yes — use a dedicated non-pooled connection if you need it |

If you write SQL that depends on session-scoped state across requests on v2, the symptoms are non-deterministic and hard to reproduce. Document this for your application's authors.

### Per-role guardrails at provisioning time

Every tenant role is provisioned with cluster-friendly limits:

```sql
ALTER ROLE t_5ecfa3ab72d1_role SET statement_timeout = '5s';
ALTER ROLE t_5ecfa3ab72d1_role CONNECTION LIMIT 5;
```

Adjusted by tier. These are cheap controls that prevent one tenant from monopolizing the cluster. Treat them as defaults, not absolutes — a Pro project that legitimately needs longer queries can have its limit raised.

### Portable tenant backups

`flux backup create` on v2 runs `pg_dump -Fc --schema=t_<shortid>_api --no-owner --no-acl` against the shared cluster. The artifact contains **only** that tenant's schema — no other tenants, no cluster-global objects.

This is a **portable tenant export**, restorable into any Postgres for migrations or off-platform analysis. It is not a substitute for cluster-level disaster recovery (physical backups, WAL archiving, PITR), which is a platform operations concern. Verification (`flux backup verify`) runs the same `pg_restore` smoke test in a disposable Postgres container that v1 uses.

Catalog rows for these backups carry `kind = tenant_export`, distinct from the `project_db` rows v1 produces.

### Scaling

- **Per-cluster planning range.** 500–2,000 tenants per shared Postgres cluster. Beyond that, `pg_namespace` catalog growth, migration fan-out time, and per-role overhead start to bite.
- **Horizontal scaling.** When a cluster approaches capacity, provision a new shared cluster and assign new tenants there via `flux-system.projects.cluster_id`. Existing tenants stay on their assigned cluster indefinitely.
- **PostgREST pool sharding.** When a single PostgREST pool becomes a bottleneck, shard by tenant hash or by tier (Free vs Pro on separate pools). The gateway's upstream lookup chooses the pool; this is an operational change, not an application-visible one.

Vertical scaling of a single cluster beyond the planning range is not the answer. The model is many right-sized clusters, not a few enormous ones.

## 8. Failure boundaries

The honest version of "what can go wrong on v2" and "what the platform does not promise."

### The top risk: JWT mis-issuance

The single most consequential failure mode on v2 is a gateway-issued bridge JWT carrying the **wrong** `role` or `tenant_id`. PostgREST will trust that JWT and `SET ROLE` accordingly; PostgreSQL will then serve whatever that role is allowed to see. There is no further database-level guard unless an application has added [RLS](/docs/concepts/rls) for its own reasons — and v2's baseline does not.

The defense is **gateway correctness**:

- The gateway is the only code path that issues runtime JWTs (invariant 3 below). No other service mints a token PostgREST will accept on this path.
- `tenant_id` is validated against `flux-system` on every resolution; the bridge JWT reflects the database record, not a value the client supplied.
- Bridge JWT TTL is short (1–5 minutes). A mis-issued token has a small window to do damage before it expires.
- The gateway resolution path and host parser are tested against both flattened and dotted hostnames, and against tenant-renaming flows.

This is the failure mode that justifies treating the gateway as a security control rather than a proxy.

### What v2 does not promise

- **RLS on by default.** Schema and role separation are the load-bearing boundary on v2. RLS is an opt-in tool your application adds when its data model needs row-by-row checks.
- **Hard CPU or memory isolation.** v2 is shared; cluster-level blast radius is the deliberate tradeoff. If you need hardware isolation, [v1 dedicated](/docs/concepts/pooled-vs-dedicated) is the right mode.
- **Compliance posture on shared infrastructure.** SOC 2 and HIPAA workloads belong on `v1_dedicated`. v2 is not a compliance boundary.
- **Protection from compromised IdP keys.** Your identity provider's signing keys remain in scope. If those keys leak, an attacker can mint tokens your gateway accepts; rotating the per-project `jwt_secret` is the response.
- **Strict rate limiting during Redis outages.** The default is fail-open (availability over enforcement). A future Pro+ option may opt into fail-closed; today, an extended Redis outage makes rate limits advisory.

For the equivalent reader-facing framing, see [Threat model](/docs/security/threat-model).

### Operational risks tracked in the open

| Risk | Severity | Note |
|------|----------|------|
| `pg_namespace` catalog bloat above 2,000 schemas per cluster | medium | Hard cluster cap; horizontal scaling plan above |
| Migration fan-out across many tenant schemas | medium | DDL fan-out is slow at scale; tooling is incremental |
| PostgREST pool reload at scale | low–medium | Rolling restart strategy needed to avoid dropped in-flight requests |
| Custom-domain cache eviction gaps | low | Mitigated by explicit eviction on domain ops |
| RLS opt-in for Pro+ | future | Not in v2 scope today; tracked as a future tier enhancement |
| Enterprise on shared infrastructure | future | Requires compliance review and explicit migration; not an automatic flag |

These are tracked openly because hiding them would not make them go away.

## 9. Migration to dedicated

If your project outgrows pooled or your compliance posture changes, `flux migrate` orchestrates a move from `v2_shared` to `v1_dedicated`. The control plane provisions the dedicated stack, dumps the tenant schema with `pg_dump`, restores into the new database, and (on full cutover) flips the `mode` field. The Service URL shape is preserved; your app's env may need to update if you rotated secrets during the move.

The migration is staged, dry-runnable, and explicit. See [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate) for the full procedure, the success checklist, and the troubleshooting notes.

A future tool may allow `v1_dedicated → v2_shared` migration. It is not available today and is not on a timeline.

---

## Reference

The sections below are stable contracts the rest of this page builds on. They are written for the reader who wants to verify a claim without re-reading the prose, and for the Flux maintainers who treat them as code-review gates.

### Invariants

These rules are unconditional. The Flux team treats violations as blocking review issues.

| # | Invariant |
|---|-----------|
| 1 | `tenant_id` (UUID) is **immutable**. Slug is UI-only and may change. |
| 2 | Postgres schema and role names are derived **only** from `tenant_id` via the deterministic `shortid`. Slug is **never** embedded in a schema or role identifier. |
| 3 | The **gateway is the only issuer of bridge JWTs** for tenant API traffic. |
| 4 | **PostgREST is not publicly reachable.** Only the gateway has a network path to it. |
| 5 | **Redis is never authoritative.** It is cache and best-effort telemetry. Wiping Redis must not affect data correctness. |
| 6 | **Per-tenant schemas are never enumerated in `PGRST_DB_SCHEMAS`.** Access is controlled by role grants, `search_path`, and JWT `role`. Listing tenant schemas there widens introspection surface and makes isolation depend on JWT claims alone. |

### What Flux deliberately does not do

These are not bugs or future work. They are absences chosen on purpose.

| Pattern | Why Flux does not adopt it |
|---------|----------------------------|
| Static `anon` / `service` keys on the public internet | One leaked key compromises every request that key authorizes; the gateway-verified JWT model is the correction. See [§5 Why no static keys](#5-why-no-static-keys). |
| RLS enabled by default on every tenant schema | Speculative complexity; hurts query planning; not the load-bearing boundary on v2. RLS remains available where applications need it ([RLS](/docs/concepts/rls)). |
| Extra abstraction layers (`TenantService`, `RoutingService`, etc.) inside `@flux/core` | Premature indirection without payoff at this scale. The engine interface is small; new abstractions earn their place. |
| Async job queues introduced before they are needed | Operational complexity before product-market fit. The control plane is imperative today; a reconcile loop will arrive when the operational model justifies it. |
| Redis errors propagating into the gateway hot path | Violates the fail-open contract; blocks legitimate requests for a cache outage. The non-blocking pattern is enforced. |
| `mode` inferred solely from `plan` | `mode` is the source of truth. `plan` may default new provisioning, but the engine must never be chosen by an implicit `if (plan === "enterprise")` check. |
| Gateway logic in `@flux/core` or DB logic in `@flux/cli` | Violates the control-plane / data-plane boundary. `@flux/cli` is a thin wrapper; `@flux/gateway` owns the request path. |

This is the **no-shim policy** made concrete: Flux refuses to add layers, defaults, or escape hatches that would let the platform appear smaller while making applications larger.

### Repository layout

| Package / app | Layer | v2 role |
|---------------|-------|---------|
| `packages/core` (`@flux/core`) | control plane | engine registry, canonical types, project orchestration |
| `packages/engine-v1` (`@flux/engine-v1`) | engine | dedicated container execution strategy (`v1_dedicated`) |
| `packages/engine-v2` (`@flux/engine-v2`) | engine | shared cluster execution strategy (`v2_shared`) |
| `packages/gateway` (`@flux/gateway`) | data plane | resolve → verify → rate-limit → bridge JWT → proxy |
| `packages/cli` (`@flux/cli`) | control plane | CLI surface; wraps `@flux/core`; no DB or gateway logic |
| `packages/sdk` (`@flux/sdk`) | client | tenant API client |
| `apps/dashboard` | control plane | UI + API routes; reads from `flux-system` |

This map is contributor-facing. App builders never need to install or import any of these packages.

## Next steps

- [Mental model](/docs/introduction/mental-model) — the same picture, one screen, no internals.
- [Gateway](/docs/architecture/gateway) — the resolve → verify → bridge → proxy hop in more detail.
- [Bridge JWTs](/docs/architecture/bridge-jwts) — what the internal token carries and why.
- [Threat model](/docs/security/threat-model) — the failure boundaries above, framed for the security reader.
- [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate) — when v2 stops being the right answer.
