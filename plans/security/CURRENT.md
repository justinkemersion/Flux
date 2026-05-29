# Security passes — current phase

**Read this first** when working in the Flux repo (human or agent).  
**Canonical detail:** [`pass-1-summary.md`](pass-1-summary.md) · **History:** [`docs/_review/baselines.md`](../../docs/_review/baselines.md)

| Field | Value |
|-------|--------|
| **Active phase** | **Deferred** — none (Pass 5b complete) |
| **Pass 1** | **Complete** (code + docs; server e2e smoke verified 2026-05-29) |
| **Pass 2** | **Complete** (destructive backup gate + dashboard UI) |
| **Pass 3** | **Complete** (system-db cutover gating) |
| **Last updated** | 2026-05-29 (Pass 5b `project-manager` split) |

---

## Pass 1 — done (do not re-litigate)

- [x] 1A — Gateway Bearer required; `auth.uid()`; `pgrst.db_schemas=public`; Postgres localhost bind
- [x] 1A½ — Mesh = edge reachable (401 healthy; UI copy)
- [x] 1B — `flux.flux_migrations (tenant_schema, version)`; `normalizePushSql` before checksum
- [x] 1C — GRANT docs → `t_<shortId>_role`; `unique (userId, hash)`

**Verification still worth doing on the server:** `bin/e2e-v2-shared-smoke.sh` with `FLUX_SMOKE_*` (see pass-1-summary § Smoke).

---

## Pass 2 — done

**Goal:** Restore-verified backup required before destructive actions (same bar as `flux nuke`), unless explicit override.

| Surface | Status | Notes |
|---------|--------|--------|
| `flux nuke` | Done | CLI + server `DELETE /cli/v1/projects/:hash`; `--skip-backup-check` |
| `flux migrate` (v2→v1) | Done | CLI + `POST /cli/v1/migrate` when not `--dry-run` |
| `flux db-reset` | Done | Already used `ensureRestoreVerifiedLatestBackup` |
| Dashboard DELETE project | Done | `DELETE /api/projects/[slug]` → 412; `?skipBackupCheck=true` override |
| Dashboard factory reset | Done | `POST …/factory-reset` → 412; query override |
| Dashboard UI gate | Done | Delete + factory reset disabled until restorable; modals + Database tools link |
| Dashboard migrate UI | N/A | No destructive dashboard route (CLI only) |

**Shared primitive:** `@flux/core/backup-trust` (`classifyBackupTrust`, `allowsDestructiveWithoutOverride`).

**Suggested commits:** one per surface (or CLI vs dashboard split) for bisect.

---

## Pass 3 — done (audit #9)

**Goal:** Catalog bootstrap stays additive on restart; legacy DROP cutovers require operator opt-in and a ledger row.

| Item | Status | Notes |
|------|--------|--------|
| Gate Auth.js UUID → text cutover | Done | `FLUX_SYSTEM_DB_ALLOW_DESTRUCTIVE_CUTOVER`; `flux_system_cutovers` ledger |
| Gate pre-hash `projects` drop | Done | Same flag + ledger |
| Env/docs | Done | `apps/dashboard/.env.example`, README ownership map |

---

## Pass 4 — done (fleet deep probe)

**Goal:** v2 fleet/catalog health requires `jwt_secret` and a minted project JWT reaching PostgREST (2xx), not unauthenticated 401.

| Item | Status | Notes |
|------|--------|--------|
| `probeV2SharedCatalogProject` | Done | Mints fleet probe JWT; 2xx required |
| `jwt_secret` pre-check | Done | Missing secret → `error` (no 401-as-healthy) |
| Shallow fallback | Done | `FLUX_TENANT_PROBE_SHALLOW=1` restores Pass 1A 401 semantics |
| UI copy | Done | “API reachable” + updated tooltip |

---

## Pass 5 — done (audit #10, dashboard)

**Goal:** Split `project-card.tsx` below architecture warn threshold (800 lines).

| Item | Status | Notes |
|------|--------|--------|
| Extract connect / CLI / logs / modals | Done | `project-card.tsx` 786 lines; 6 sibling modules |

## Pass 5b — done (audit #10, CLI + core)

| Item | Status | Notes |
|------|--------|--------|
| Split `cli-handlers.ts` | Done | 8 modules under `cli-handlers/`; barrel `cli-handlers.ts` |
| Split `register-cli.ts` | Done | 8 modules under `register-cli/` + `shared.ts` action helpers |
| Split `project-manager.ts` | Done | 10 modules under `project-manager/`; barrel ~400 lines; ctx-first delegates |

---

## Deferred

- (none — audit #10 large-file splits complete)

---

## Agent workflow (interrupt pattern)

1. **Start of session** — Read this file. State active phase in one sentence.
2. **New task** — If it is not Pass 2 (or a Pass 1 deploy/smoke fix), **ask the user** whether to defer the security queue.
3. **Implementation** — Follow pass-1-summary smoke after meaningful changes; **one commit per pass slice** when the user asks to commit.
4. **Pass complete** — Update checkboxes here, append `baselines.md`, refresh “Last updated”.

---

## Human decision gates

When the agent is about to start substantial work, it should ask:

1. **Are we doing Pass 2 next**, or something else (features, docs-only, ops)?
2. **Has Pass 1 been deployed and smoke-tested** on the target environment?
3. **Override policy** — Is `--skip-backup-check` / dashboard equivalent acceptable for this change?

---

## Smoke (quick)

```bash
pnpm check:architecture && pnpm typecheck && pnpm test
# Live: FLUX_SMOKE_BEARER="$(FLUX_SMOKE_PROJECT_SLUG=… FLUX_SMOKE_PROJECT_HASH=… ./bin/mint-smoke-bearer.sh)"
#       FLUX_SMOKE_KNOWN_HOST=api--<slug>--<hash>.<domain> ./bin/e2e-v2-shared-smoke.sh
```

Pass 2 Cursor prompt: [`pass-1-summary.md` § Pass 2](pass-1-summary.md#pass-2--next-destructive-operation-guardrails).
