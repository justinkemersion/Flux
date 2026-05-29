# Security passes — current phase

**Read this first** when working in the Flux repo (human or agent).  
**Canonical detail:** [`pass-1-summary.md`](pass-1-summary.md) · **History:** [`docs/_review/baselines.md`](../../docs/_review/baselines.md)

| Field | Value |
|-------|--------|
| **Active phase** | **Pass 2 complete** — pick next work from Deferred or new audit |
| **Pass 1** | **Complete** (code + docs; deploy/e2e on server may still be pending) |
| **Last updated** | 2026-05-29 |

---

## Pass 1 — done (do not re-litigate)

- [x] 1A — Gateway Bearer required; `auth.uid()`; `pgrst.db_schemas=public`; Postgres localhost bind
- [x] 1A½ — Mesh = edge reachable (401 healthy; UI copy)
- [x] 1B — `flux.flux_migrations (tenant_schema, version)`; `normalizePushSql` before checksum
- [x] 1C — GRANT docs → `t_<shortId>_role`; `unique (userId, hash)`

**Verification still worth doing on the server:** `bin/e2e-v2-shared-smoke.sh` with `FLUX_SMOKE_*` (see pass-1-summary § Smoke).

---

## Pass 2 — active (next implementation)

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

## Deferred (not Pass 2 unless you reprioritize)

- [ ] System-db destructive bootstrap hardening (audit #9)
- [ ] Large-file splits (audit #10)
- [ ] Fleet JWT “deep smoke” (authenticated probe / E2E green)
- [ ] Optional: catalog `jwt_secret` pre-check before mesh probe

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
# Live: FLUX_SMOKE_KNOWN_HOST=… FLUX_SMOKE_BEARER=… ./bin/e2e-v2-shared-smoke.sh
```

Pass 2 Cursor prompt: [`pass-1-summary.md` § Pass 2](pass-1-summary.md#pass-2--next-destructive-operation-guardrails).
