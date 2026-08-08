/**
 * Post-push invariants for v2_shared tenant schemas (Pass 6b).
 *
 * Pushed DDL runs as the per-tenant owner role `t_<12hex>_ddl`; PostgREST serves
 * traffic as `t_<12hex>_role`. Keeping those identities distinct is what makes RLS
 * apply at runtime, because a table owner bypasses RLS unless the table is
 * `FORCE ROW LEVEL SECURITY`. These builders assert that separation after every push
 * instead of trusting it to hold.
 */

const TENANT_SCHEMA_RE = /^t_[0-9a-f]{12}_api$/u;
const TENANT_RUNTIME_ROLE_RE = /^t_[0-9a-f]{12}_role$/u;

function assertTenantSchema(schema: string): void {
  if (!TENANT_SCHEMA_RE.test(schema)) {
    throw new Error(`Invalid tenant schema "${schema}" (expected t_<12hex>_api)`);
  }
}

function assertRuntimeRole(role: string): void {
  if (!TENANT_RUNTIME_ROLE_RE.test(role)) {
    throw new Error(`Invalid tenant runtime role "${role}" (expected t_<12hex>_role)`);
  }
}

/**
 * Opt-out marker for {@link buildForceRlsInvariantSql}. Put it in a table comment to
 * keep a deliberately owner-readable table out of the FORCE sweep, e.g.
 * `COMMENT ON TABLE t_x_api.audit IS 'flux:no-force-rls — append-only, read via view';`
 */
export const FORCE_RLS_EXEMPTION_MARKER = "flux:no-force-rls" as const;

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Applies `FORCE ROW LEVEL SECURITY` to tenant tables that already have RLS enabled.
 *
 * Scoped deliberately: tables without RLS are left alone (forcing them would be a
 * behavior change the tenant did not ask for), and tables whose comment carries
 * {@link FORCE_RLS_EXEMPTION_MARKER} are skipped.
 */
export function buildForceRlsInvariantSql(tenantSchema: string): string {
  assertTenantSchema(tenantSchema);
  return `
DO $flux_force_rls$
DECLARE
  target regclass;
BEGIN
  FOR target IN
    SELECT c.oid::regclass
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${sqlLiteral(tenantSchema)}
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND NOT c.relforcerowsecurity
      AND coalesce(obj_description(c.oid, 'pg_class'), '') NOT LIKE ${sqlLiteral(`%${FORCE_RLS_EXEMPTION_MARKER}%`)}
  LOOP
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  END LOOP;
END
$flux_force_rls$;`.trim();
}

/**
 * Fails the push transaction if the runtime PostgREST role owns anything in the tenant
 * schema. Ownership there would silently disable RLS for that same role at request time,
 * so this rolls back rather than shipping a schema that looks correct but is not enforced.
 */
export function buildAssertRuntimeRoleOwnsNothingSql(
  tenantSchema: string,
  runtimeRole: string,
): string {
  assertTenantSchema(tenantSchema);
  assertRuntimeRole(runtimeRole);
  return `
DO $flux_owner_check$
DECLARE
  offending int;
BEGIN
  SELECT count(*) INTO offending
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = ${sqlLiteral(tenantSchema)}
    AND c.relkind IN ('r', 'v', 'm', 'S')
    AND pg_get_userbyid(c.relowner) = ${sqlLiteral(runtimeRole)};

  IF offending > 0 THEN
    RAISE EXCEPTION
      'Refusing push: % object(s) in % are owned by the runtime role %, which bypasses RLS',
      offending, ${sqlLiteral(tenantSchema)}, ${sqlLiteral(runtimeRole)};
  END IF;
END
$flux_owner_check$;`.trim();
}
