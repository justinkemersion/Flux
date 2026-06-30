-- Latest backup row per project (unique by project id, not slug).
-- Used by bin/ops-audit.sh audit_backup_catalog.
SELECT DISTINCT ON (p.id)
  p.slug,
  p.hash,
  p.mode,
  COALESCE(p.lifecycle_state, 'active') AS lifecycle_state,
  b.status,
  b.artifact_validation_status,
  b.restore_verification_status,
  b.offsite_status,
  b.created_at::date
FROM project_backups b
JOIN projects p ON p.id = b.project_id
ORDER BY p.id, b.created_at DESC;
