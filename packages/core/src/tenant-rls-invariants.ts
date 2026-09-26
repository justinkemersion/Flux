/**
 * Post-push invariants for v2_shared tenant schemas (Pass 6b).
 *
 * Pushed DDL runs as the per-tenant owner role `t_<12hex>_ddl`; PostgREST serves
 * traffic as `t_<12hex>_role`. Keeping those identities distinct is what makes RLS
 * apply at runtime, because a table owner bypasses RLS unless the table is
 * `FORCE ROW LEVEL SECURITY`. These builders assert that separation after every push
 * instead of trusting it to hold.
 *
 * The same FORCE sweep blinds `SECURITY DEFINER` functions owned by the DDL role:
 * they run as that owner, the owner has no `BYPASSRLS`, and policies that name only
 * the runtime role do not apply. Reads then return zero rows with no error.
 * {@link buildInspectBlindedSecurityDefinersSql} is a catalog-only lexical scan for
 * that shape. Push warns; `flux doctor` fails. The scan does not read tenant rows.
 */
import { SECURITY_WARNING_PREFIX } from "./exposed-table-security.ts";

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

/**
 * Marker comment on {@link buildInspectBlindedSecurityDefinersSql}. The audit is a
 * warning at push time, not a rollback: known tenants already have this shape, and
 * the detector is lexical.
 */
export const BLINDED_DEFINER_AUDIT_SQL_MARKER = "flux:blinded-security-definer-audit";

/** How many function/table hits a single push response will spell out. */
const BLINDED_DEFINER_WARNING_CAP = 20;

export type BlindedSecurityDefinerFinding = {
  schema: string;
  functionName: string;
  /** `pg_get_function_identity_arguments` text; empty when the function has no args. */
  identityArgs: string;
  ownerRole: string;
  tableSchema: string;
  tableName: string;
};

/**
 * Read-only catalog query: SECURITY DEFINER functions in `tenantSchema` whose owner
 * lacks BYPASSRLS (and is not a superuser) and whose source reads a FORCE RLS table
 * in that schema with no permissive SELECT/ALL policy for the owner or PUBLIC.
 *
 * Heuristic, not a parser:
 * - Matches `FROM` / `JOIN` of a plain lowercase table name (`relkind = 'r'`),
 *   optionally schema-qualified, after stripping comments.
 * - String literals are kept, so `EXECUTE 'SELECT … FROM notes'` is flagged.
 * - Dynamic SQL that builds the name at runtime (`format('%I', …)`, concatenation)
 *   is not visible and is not flagged.
 * - A comma-separated later item (`FROM a, notes`), a read that only goes through
 *   a view, and quoted mixed-case identifiers are not flagged.
 * - Does not return `prosrc` or any tenant row.
 */
export function buildInspectBlindedSecurityDefinersSql(tenantSchema: string): string {
  assertTenantSchema(tenantSchema);
  const schemaLit = sqlLiteral(tenantSchema);
  return `
-- ${BLINDED_DEFINER_AUDIT_SQL_MARKER}
WITH funcs AS (
  SELECT
    n.nspname AS schema_name,
    p.proname AS function_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args,
    owner.rolname AS owner_role,
    owner.oid AS owner_oid,
    regexp_replace(
      regexp_replace(p.prosrc, '/\\*.*?\\*/', ' ', 'gn'),
      '--.*',
      ' ',
      'g'
    ) AS body
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_roles owner ON owner.oid = p.proowner
  WHERE n.nspname = ${schemaLit}
    AND p.prokind = 'f'
    AND p.prosecdef
    AND NOT owner.rolsuper
    AND NOT owner.rolbypassrls
),
tables AS (
  SELECT
    c.oid,
    c.relname,
    n.nspname AS table_schema
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = ${schemaLit}
    AND c.relkind = 'r'
    AND c.relforcerowsecurity
    AND c.relname ~ '^[a-z_][a-z0-9_]*$'
)
SELECT
  f.schema_name,
  f.function_name,
  f.identity_args,
  f.owner_role,
  t.table_schema,
  t.relname AS table_name
FROM funcs f
JOIN tables t ON t.table_schema = f.schema_name
WHERE f.body ~* (
  '(\\mfrom\\M|\\mjoin\\M)[[:space:]]+((only|lateral)[[:space:]]+)?'
  || '((("?' || t.table_schema || '"?)[[:space:]]*\\.[[:space:]]+)?)'
  || '(\\m' || t.relname || '\\M|"' || t.relname || '")'
)
AND NOT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_policy pol
  WHERE pol.polrelid = t.oid
    AND pol.polpermissive
    AND pol.polcmd IN ('*', 'r')
    AND (
      cardinality(pol.polroles) = 0
      OR 0::oid = ANY (pol.polroles)
      OR EXISTS (
        SELECT 1
        FROM unnest(pol.polroles) AS pr(roleid)
        WHERE pr.roleid <> 0::oid
          AND pg_catalog.pg_has_role(f.owner_oid, pr.roleid, 'USAGE')
      )
    )
)
ORDER BY f.function_name, f.identity_args, t.relname`.trim();
}

function asAuditString(value: unknown, field: string): string {
  if (typeof value === "string") return value;
  if (value == null && field === "identity_args") return "";
  throw new Error(`Blinded definer audit row missing ${field}`);
}

export function parseBlindedSecurityDefinerFindings(
  rows: readonly unknown[],
): BlindedSecurityDefinerFinding[] {
  return rows.map((row) => {
    const rec = (row ?? {}) as Record<string, unknown>;
    return {
      schema: asAuditString(rec.schema_name ?? rec.schema, "schema_name"),
      functionName: asAuditString(rec.function_name ?? rec.functionName, "function_name"),
      identityArgs: asAuditString(rec.identity_args ?? rec.identityArgs, "identity_args"),
      ownerRole: asAuditString(rec.owner_role ?? rec.ownerRole, "owner_role"),
      tableSchema: asAuditString(rec.table_schema ?? rec.tableSchema, "table_schema"),
      tableName: asAuditString(rec.table_name ?? rec.tableName, "table_name"),
    };
  });
}

export function formatBlindedSecurityDefinerWarning(
  finding: BlindedSecurityDefinerFinding,
): string {
  const signature = `${finding.schema}.${finding.functionName}(${finding.identityArgs})`;
  const table = `${finding.tableSchema}.${finding.tableName}`;
  return (
    `${SECURITY_WARNING_PREFIX} SECURITY DEFINER ${signature} owned by ${finding.ownerRole} ` +
    `reads FORCE RLS table ${table}, which has no permissive SELECT policy for that owner or PUBLIC. ` +
    `Add a SELECT policy TO ${finding.ownerRole}. Do not grant BYPASSRLS and do not disable FORCE ROW LEVEL SECURITY.`
  );
}

/** Push-facing warnings. Empty when nothing is blinded. Does not roll back the push. */
export function formatBlindedSecurityDefinerWarnings(
  findings: readonly BlindedSecurityDefinerFinding[],
): string[] {
  if (findings.length === 0) return [];
  const shown = findings
    .slice(0, BLINDED_DEFINER_WARNING_CAP)
    .map(formatBlindedSecurityDefinerWarning);
  if (findings.length > BLINDED_DEFINER_WARNING_CAP) {
    shown.push(
      `${SECURITY_WARNING_PREFIX} ${String(findings.length - BLINDED_DEFINER_WARNING_CAP)} more blinded SECURITY DEFINER hit(s) not listed. Run flux doctor.`,
    );
  }
  shown.push(
    `${SECURITY_WARNING_PREFIX} Definer RLS scan is lexical (function source after comment stripping). ` +
      "Dynamic SQL that builds the table name at runtime is not detected. " +
      "A string literal that contains FROM or JOIN of the table name can be flagged.",
  );
  return shown;
}
