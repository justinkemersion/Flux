# Ops backlog — empty v2 tenant restore verification

**Status:** `todo` (product ticket — do not implement silently)  
**Opened:** 2026-06-30 (yeastcoast duplicate cleanup)  
**Scope:** Control-plane restore verification policy only — not MCP, not v1/v2 runtime, not backup export format unless required.

---

## Problem

v2_shared **tenant_export** backups for **schema-only empty tenants** (no user tables) fail restore verification with:

```text
Restore verification failed: no user tables found after pg_restore.
```

The artifact is valid (`artifact_valid`, small schema-only dump). The failure is policy in `apps/dashboard/src/lib/project-backups.ts` (`tableCount <= 0` after `pg_restore`).

This caused:

- Hourly platform backup scheduler noise for duplicate empty v2 `yeastcoast` (`3db3f78`)
- Ops audit FAIL on latest backup row (before archive + slug-collision fix)

## Desired behavior

Classify **empty but structurally valid** tenant exports explicitly, e.g.:

| Proposed tier | Meaning |
|---------------|---------|
| `restorable_empty_tenant` | pg_restore succeeded; tenant schema present; zero user tables — acceptable for empty fixtures |
| `backup_empty_but_valid` | Same bar; name TBD |

**Must still fail** corrupt/partial artifacts:

- pg_restore errors
- artifact validation failures
- missing expected tenant schema after restore
- checksum / format problems

**Must not** silently mark corrupt backups as verified.

## Implementation notes (future)

- After `pg_restore`, if `tableCount === 0`, inspect restored schemas (expect `t_<shortId>_api` for v2 exports).
- Require schema-only exports to include the tenant API schema object from the dump TOC.
- Record distinct `restore_verification_status` (or metadata flag) so ops-audit and `@flux/core/backup-trust` can treat empty-valid separately from `restore_failed`.
- Update destructive gates only if product agrees empty tenants satisfy “restorable” for Pass 2 — **default: no** until explicit policy decision.

## Related ops work (2026-06-30)

- Archived duplicate v2 `yeastcoast` (`3db3f78`); v1 `ffca33f` remains active.
- `bin/ops-audit.sh`: project identity = `slug:hash` / `DISTINCT ON (p.id)`; skip FAIL for non-active lifecycle on restore_failed.
- Platform scheduler: exclude `archived` projects from `projectsDueForPlatformBackup`.

## Acceptance criteria

- [ ] Empty v2 fixture with only tenant schema passes verify with explicit classification
- [ ] Corrupt/truncated dumps still `restore_failed`
- [ ] Ops audit documents empty-valid vs failed
- [ ] Unit tests for table-count-zero + schema-present path
