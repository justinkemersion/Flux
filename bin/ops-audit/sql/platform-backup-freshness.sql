-- Restore-verified freshness per active project (slug + hash identity).
-- Archived/dormant projects are excluded from platform minimum freshness checks.
SELECT p.slug,
  p.hash,
  p.mode,
  lv.restore_verification_at::date,
  CASE
    WHEN lv.restore_verification_at IS NULL THEN NULL
    ELSE (CURRENT_DATE - lv.restore_verification_at::date)
  END AS age_days
FROM projects p
LEFT JOIN LATERAL (
  SELECT b.restore_verification_at
  FROM project_backups b
  WHERE b.project_id = p.id
    AND b.status = 'complete'
    AND b.restore_verification_status = 'restore_verified'
    AND b.restore_verification_at IS NOT NULL
  ORDER BY b.restore_verification_at DESC
  LIMIT 1
) lv ON true
WHERE p.slug NOT IN ('flux-system', 'static')
  AND COALESCE(p.lifecycle_state, 'active') = 'active'
ORDER BY p.slug, p.hash;
