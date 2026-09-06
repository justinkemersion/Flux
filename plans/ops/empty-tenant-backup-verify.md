# Ops backlog — empty v2 tenant restore verification

**Status:** `done` (2026-09-06)  
**Opened:** 2026-06-30 (yeastcoast duplicate cleanup)  
**Shipped:** 2026-09-06 — schema-only empty `tenant_export` dumps pass verify when restore + TOC agree the tenant is empty  
**Scope:** Control-plane restore verification policy only — not MCP, not v1/v2 runtime, not backup export format.

---

## Problem

v2_shared **tenant_export** backups for **schema-only empty tenants** (no user tables) failed restore verification with:

```text
Restore verification failed: no user tables found after pg_restore.
```

The artifact was valid (`artifact_valid`, small schema-only dump). The failure was policy in `apps/dashboard/src/lib/project-backups.ts` (`tableCount <= 0` after `pg_restore`).

This caused:

- Hourly platform backup scheduler noise for empty v2 tenants (`held-in-trust`, archived `yeastcoast`)
- Ops audit FAIL on the latest backup row while the project stayed `active`

## Shipped behavior

Empty `tenant_export` restores are a **valid** verification outcome when all of the following hold:

1. `pg_restore` exits 0
2. Restored database has **zero** user tables
3. Expected tenant schema `t_<shortId>_api` exists after restore
4. Dump TOC (`pg_restore --list`) includes that schema
5. Dump TOC lists **zero** `TABLE` entries in that schema (emptiness matches the dump, not a dropped restore)

The catalog status written is still **`restore_verified`**. Freshness, `@flux/core/backup-trust`, destructive gates, and ops-audit all key off that status — a separate persisted tier would have left the hourly scheduler in `never_verified` / `restore_failed` retry loops.

The classifier name `restorable_empty_tenant` is the internal outcome label (logged on verify). It is **not** a new `restore_verification_status` value.

| Outcome | Catalog status | Meaning |
|---------|----------------|---------|
| Non-empty restore (`tableCount > 0`) | `restore_verified` | Unchanged |
| Empty tenant, schema + empty TOC | `restore_verified` (log: `restorable_empty_tenant`) | Valid schema-only export |
| `pg_restore` error / invalid artifact / missing schema / TOC has tables but restore has none | `restore_failed` | Unchanged fail-closed |

**Must still fail** (and does):

- `pg_restore` errors
- artifact validation failures
- missing expected tenant schema after restore
- dump TOC missing the tenant schema
- TOC lists user tables but restore found none (corrupt/partial)
- empty `project_db` (v1 dedicated) — the allow path is `tenant_export` only

**Pass 2 / destructive gates:** an empty-but-structurally-valid export **is** restorable (you get the tenant schema back). Product decision: treat it as `restore_verified`, same as a non-empty success. The original “default: no” hold was about not silently marking corrupt empties as verified — the TOC + schema checks are that gate.

## Implementation

- Policy: `apps/dashboard/src/lib/backup-restore-verify-outcome.ts`
- Tests: `apps/dashboard/src/lib/backup-restore-verify-outcome.test.ts`
- Wired from `verifyBackupRestore` in `apps/dashboard/src/lib/project-backups.ts`

## Related ops work (2026-06-30)

- Archived duplicate v2 `yeastcoast` (`3db3f78`); v1 `ffca33f` remains active.
- `bin/ops-audit.sh`: project identity = `slug:hash` / `DISTINCT ON (p.id)`; skip FAIL for non-active lifecycle on restore_failed.
- Platform scheduler: exclude `archived` projects from `projectsDueForPlatformBackup`.

## Acceptance criteria

- [x] Empty v2 fixture with only tenant schema passes verify with explicit classification (`restorable_empty_tenant` → persisted `restore_verified`)
- [x] Corrupt/truncated dumps still `restore_failed` (TOC/schema mismatch, `pg_restore` errors)
- [x] Ops audit documents empty-valid vs failed (empty-valid is `restore_verified`; `restore_failed` remains FAIL for active projects)
- [x] Unit tests for table-count-zero + schema-present path, and TOC-has-tables / missing-schema failures
