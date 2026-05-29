# Pass 1 — Critical security / contract fixes

**Status:** Complete (2026-05-29)  
**Audit source:** Codex security review (findings #1–#8, “Do now”)  
**Execution model:** Small passes, one commit (or tight pair) per pass for bisect.

**Live tracker (start here each session):** [`CURRENT.md`](CURRENT.md)  
This file is the **repeatable baseline** for the Codex → Cursor audit loop. Pair it with [`docs/_review/baselines.md`](../../docs/_review/baselines.md) (institutional memory entry).

---

## What Pass 1 delivered

| # | Finding | Outcome |
|---|---------|---------|
| 1 | Unauthenticated v2 gateway traffic | **Require verified project Bearer** before proxy; missing/invalid → `401 authorization required` |
| 2 | Docs GRANTs vs `t_<shortId>_role` | **Guides + AGENTS** use tenant role in GRANT/JWT examples |
| 3 | Missing `auth.uid()` on v2 cluster | **Global/cluster bootstrap** installs `auth` schema + `auth.uid()` |
| 4 | PostgREST schema enumeration | **`pgrst.db_schemas = public` only** (invariant #6) |
| 5 | Dev Postgres exposed on `0.0.0.0` | **`127.0.0.1:15433:5432`** bind in v2-shared compose |
| 6 | Global `flux.flux_migrations` on shared pool | **PK `(tenant_schema, version)`**; legacy rows fail closed |
| 7 | Hash collision scope | **`unique (userId, hash)`** + allocation checks per user |
| 8 | Checksum vs PG17 dump lines | **`normalizePushSql`** before checksum and execution |

**Mesh (1A½, not a separate audit item):** Fleet/UI treat v2 **401** as **edge reachable** (gateway resolved host + auth gate). Copy says **Edge reachable** — not full JWT/RLS/grant verification.

---

## Commits (bisect order, oldest → newest)

| Commit | Summary |
|--------|---------|
| `f4b3273` | Gateway requires verified project Bearer JWT |
| `50e5205` | Install `auth.uid()` on v2 shared cluster bootstrap |
| `69e4480` | Pin PostgREST `pgrst.db_schemas` to public only |
| `863a9ab` | Bind dev Postgres publish to localhost only |
| `10f4f43` | Grant `auth` only to roles that exist on shared cluster |
| `2492b8a` | Fleet probe: v2 gateway 401 = healthy |
| `92ac18d` | Dashboard: mesh label “Edge reachable” + tooltip |
| `db998bd` | Tenant-scoped migration ledger + SQL normalize |
| `1795142` / `4c90fa1` | Typecheck fix: `tenantSchema` in `pushSqlFromCli` |
| `a7c3a6a` | Pass 1C: tenant role GRANT docs + per-user hash uniqueness |

---

## Smoke baseline (recorded 2026-05-29)

Run from repo root after Pass 1 merges. Re-run before Pass 2 and after deploy.

```bash
pnpm check:architecture          # pass (4 line-count warnings, non-fatal)
pnpm --filter @flux/core exec tsc --noEmit
pnpm --filter dashboard exec tsc --noEmit   # CI “typecheck” equivalent
pnpm test                       # all workspace packages green

# Live stack only (requires gateway + catalog project):
export FLUX_SMOKE_GATEWAY_URL=http://127.0.0.1:4000   # or flux-node-gateway:4000 in Compose
export FLUX_SMOKE_KNOWN_HOST=api--<slug>--<hash>.<domain>
export FLUX_SMOKE_BEARER="$(mint HS256 with project jwt_secret; role per tenant)"
./bin/e2e-v2-shared-smoke.sh    # expects 2xx through gateway → PostgREST
```

**Local run (2026-05-29):** architecture + typecheck + unit tests **passed**. E2E **skipped** (no `FLUX_SMOKE_KNOWN_HOST` in this environment). Run on **flux.vsl-base.com** (or staging) before calling Pass 1 “deploy verified.”

**Post-deploy operator order (unchanged):**

1. `./bin/deploy-v2-shared.sh`
2. `./bin/deploy-gateway.sh`
3. `./bin/deploy-web.sh` — set `FLUX_TENANT_PROBE_GATEWAY_URL=http://flux-node-gateway:4000` in `docker/web/.env`

---

## Probe semantics (frozen for Pass 1)

| Signal | Mesh / health meaning |
|--------|------------------------|
| **401** (v2, no Bearer) | Edge reachable — host resolved, auth gate enforced |
| **503** `jwt_secret` missing | Misconfigured project — **not** healthy |
| **404** | Unresolved host / catalog drift — **not** healthy |
| **2xx** (unauthenticated probe) | Edge up (legacy / misconfigured auth off) |

Do **not** mint project JWTs from fleet monitoring in Pass 1; that is a later “deep smoke” pass.

---

## Operator notes

- **Legacy pooled ledger:** If `flux.flux_migrations` has rows without `tenant_schema`, first migration push errors with an operator message — empty legacy table auto-upgrades.
- **System DB:** `projects_user_hash_uniq` is created on bootstrap (`CREATE UNIQUE INDEX IF NOT EXISTS`).
- **Mesh copy:** Operational green ≠ app JWT/RLS verified.

---

## Explicitly out of Pass 1

- Risk-register **destructive-operation guardrails** (Pass 2)
- ~~System-db destructive bootstrap hardening (#9)~~ — **Pass 3** (gated cutovers + ledger)
- Large-file splits (#10)

---

## Pass 2 — destructive-operation guardrails (complete 2026-05-29)

**Goal:** Same backup-trust bar everywhere destructive work happens.

| Surface | Current state (audit) | Pass 2 target |
|---------|----------------------|---------------|
| `flux nuke` | `--skip-backup-check`; trust gate in CLI | Keep; align messaging with dashboard |
| `flux migrate` (v2→v1) | `--skip-backup-check` flag exists | Enforce restore-verified unless override |
| `flux` reset / db-reset | `--skip-backup-check` on some paths | Audit parity with nuke |
| Dashboard **DELETE** project | Verify gate vs CLI | Block unless latest backup restorable or explicit override |
| Dashboard **factory reset** | Verify gate | Same trust classifier as CLI |
| Dashboard **migrate** UI | If any | Same |

**Shared primitive:** `@flux/core/backup-trust` (`classifyBackupTrust`, `allowsDestructiveWithoutOverride`).

**Pass 2 prompt (for Cursor):**

```text
Implement Pass 2 from plans/security/pass-1-summary.md § Pass 2.
Enforce restore-verified backup gates on: flux migrate, dashboard DELETE,
dashboard factory-reset (and any dashboard migrate destructive path).
Reuse @flux/core/backup-trust; mirror flux nuke --skip-backup-check UX.
One commit per surface if possible. Run smoke from pass-1-summary.md.
```

---

## How to re-run this audit loop

1. **Codex / external review** → numbered findings + “Do now” vs defer.
2. **Split passes** (1A runtime, 1B data integrity, 1C docs/catalog, …).
3. **Implement + commit per pass.**
4. **Smoke** (table above) + update this file’s smoke date.
5. **Append** [`docs/_review/baselines.md`](../../docs/_review/baselines.md).
6. **Open Pass N** section at bottom of this file before coding.
