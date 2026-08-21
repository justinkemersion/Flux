/**
 * Exposed-table security inspection for v1_dedicated PostgREST API schemas.
 *
 * Dedicated projects have no gateway auth layer. Bootstrap grants PostgREST
 * roles (`anon`, `authenticated`) DML on exposed tables on the assumption that
 * RLS will restrict access. This module inspects *effective* privileges
 * (`has_table_privilege` plus ACL source) and classifies:
 *
 * - fail — RLS disabled and anon/authenticated/PUBLIC have any write privilege
 * - warn — RLS disabled with only read/no PostgREST privileges; or RLS on with zero policies
 * - pass — RLS enabled with at least one policy and no unrestricted-write condition
 *
 * Push enforcement and `flux doctor` must both consume this contract.
 */

import { assertFluxApiSchemaIdentifier } from "./api-schema-strategy.ts";

export const POSTGREST_REQUEST_ROLES = ["anon", "authenticated"] as const;
export const PUBLIC_GRANTEE = "PUBLIC" as const;
export const EXPOSED_TABLE_SECURITY_ROLES = [
  ...POSTGREST_REQUEST_ROLES,
  PUBLIC_GRANTEE,
] as const;

export const WRITE_PRIVILEGES = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
] as const;
export const READ_PRIVILEGES = ["SELECT"] as const;
export const INSPECTED_PRIVILEGES = [
  ...READ_PRIVILEGES,
  ...WRITE_PRIVILEGES,
] as const;

export const UNRESTRICTED_WRITE_ERROR_PREFIX =
  "Refusing push: unrestricted write on RLS-disabled exposed API table(s):";
export const UNRESTRICTED_WRITE_HINT =
  "Enable row level security and add policies, or revoke INSERT/UPDATE/DELETE/TRUNCATE from anon, authenticated, and PUBLIC. Flux does not change the schema automatically.";
export const SECURITY_WARNING_PREFIX = "Flux security warning:";

export type ExposedTableSecurityRole =
  (typeof EXPOSED_TABLE_SECURITY_ROLES)[number];
export type InspectedPrivilege = (typeof INSPECTED_PRIVILEGES)[number];
export type WritePrivilege = (typeof WRITE_PRIVILEGES)[number];
export type PrivilegeSource = "direct" | "inherited" | "public";

export type EffectiveTablePrivilege = {
  role: ExposedTableSecurityRole;
  privilege: InspectedPrivilege;
  sources: PrivilegeSource[];
};

export type ExposedTableSecurityFact = {
  schema: string;
  table: string;
  rlsEnabled: boolean;
  policyCount: number;
  privileges: EffectiveTablePrivilege[];
};

export type ExposedTableSecurityCode =
  | "unrestricted_write"
  | "rls_disabled_read"
  | "rls_enabled_without_policies"
  | "ok";

export type ExposedTableSecuritySeverity = "fail" | "warn" | "pass";

export type ExposedTableSecurityFinding = {
  severity: ExposedTableSecuritySeverity;
  code: ExposedTableSecurityCode;
  schema: string;
  table: string;
  qualifiedName: string;
  privileges: EffectiveTablePrivilege[];
  message: string;
};

export type ExposedSchemaSecurityReport = {
  findings: ExposedTableSecurityFinding[];
  failures: ExposedTableSecurityFinding[];
  warnings: ExposedTableSecurityFinding[];
  overall: ExposedTableSecuritySeverity;
};

const WRITE_PRIVILEGE_SET = new Set<string>(WRITE_PRIVILEGES);

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function qualifiedName(schema: string, table: string): string {
  return `${schema}.${table}`;
}

function isWritePrivilege(
  privilege: InspectedPrivilege,
): privilege is WritePrivilege {
  return WRITE_PRIVILEGE_SET.has(privilege);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function sourceLabel(sources: readonly PrivilegeSource[]): string {
  if (sources.length === 0 || (sources.length === 1 && sources[0] === "direct")) {
    return "";
  }
  const labels = uniqueSorted(sources).map((source) => {
    if (source === "public") return "PUBLIC";
    if (source === "inherited") return "inherited role membership";
    return "direct grant";
  });
  return ` via ${labels.join(" + ")}`;
}

export function formatEffectivePrivileges(
  privileges: readonly EffectiveTablePrivilege[],
): string {
  const byRole = new Map<
    string,
    { privileges: InspectedPrivilege[]; sources: PrivilegeSource[] }
  >();
  for (const entry of privileges) {
    const current = byRole.get(entry.role) ?? {
      privileges: [],
      sources: [],
    };
    current.privileges.push(entry.privilege);
    current.sources.push(...entry.sources);
    byRole.set(entry.role, current);
  }
  return [...byRole.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([role, grouped]) => {
      const privs = uniqueSorted(grouped.privileges).join(", ");
      return `${role} ${privs}${sourceLabel(uniqueSorted(grouped.sources) as PrivilegeSource[])}`;
    })
    .join("; ");
}

export function classifyExposedTableSecurity(
  fact: ExposedTableSecurityFact,
): ExposedTableSecurityFinding {
  const qualified = qualifiedName(fact.schema, fact.table);
  const writes = fact.privileges.filter((entry) =>
    isWritePrivilege(entry.privilege),
  );
  const reads = fact.privileges.filter((entry) => entry.privilege === "SELECT");

  if (!fact.rlsEnabled && writes.length > 0) {
    const detail = formatEffectivePrivileges(writes);
    return {
      severity: "fail",
      code: "unrestricted_write",
      schema: fact.schema,
      table: fact.table,
      qualifiedName: qualified,
      privileges: writes,
      message: `${qualified} has RLS disabled with effective write privileges (${detail})`,
    };
  }

  if (!fact.rlsEnabled) {
    const detail =
      reads.length > 0
        ? `effective read access (${formatEffectivePrivileges(reads)})`
        : "no effective privileges for anon, authenticated, or PUBLIC";
    return {
      severity: "warn",
      code: "rls_disabled_read",
      schema: fact.schema,
      table: fact.table,
      qualifiedName: qualified,
      privileges: reads,
      message: `${qualified} has RLS disabled with ${detail}. Unrestricted reads may be intentional or sensitive; this is not an automatic migration failure.`,
    };
  }

  if (fact.policyCount === 0) {
    return {
      severity: "warn",
      code: "rls_enabled_without_policies",
      schema: fact.schema,
      table: fact.table,
      qualifiedName: qualified,
      privileges: fact.privileges,
      message: `${qualified} has RLS enabled but no policies. Postgres denies non-owner access by default, so this is secure but likely unusable.`,
    };
  }

  return {
    severity: "pass",
    code: "ok",
    schema: fact.schema,
    table: fact.table,
    qualifiedName: qualified,
    privileges: fact.privileges,
    message: `${qualified} has RLS enabled with policies`,
  };
}

export function classifyExposedSchemaSecurity(
  facts: readonly ExposedTableSecurityFact[],
): ExposedSchemaSecurityReport {
  const findings = facts.map(classifyExposedTableSecurity);
  const failures = findings.filter((finding) => finding.severity === "fail");
  const warnings = findings.filter((finding) => finding.severity === "warn");
  const overall: ExposedTableSecuritySeverity =
    failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
  return { findings, failures, warnings, overall };
}

export function formatUnrestrictedWriteError(
  failures: readonly ExposedTableSecurityFinding[],
): string {
  const details = failures
    .map((finding) => {
      const privs = formatEffectivePrivileges(finding.privileges);
      return privs
        ? `${finding.qualifiedName} (${privs})`
        : finding.qualifiedName;
    })
    .join("; ");
  return `${UNRESTRICTED_WRITE_ERROR_PREFIX} ${details}`;
}

export function formatSecurityWarningMessages(
  warnings: readonly ExposedTableSecurityFinding[],
): string[] {
  return warnings.map(
    (finding) => `${SECURITY_WARNING_PREFIX} ${finding.message}`,
  );
}

export function isUnrestrictedWritePushError(message: string): boolean {
  return message.includes(UNRESTRICTED_WRITE_ERROR_PREFIX);
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === "t" || value === "true" || value === "1") return true;
  return false;
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asString(value: unknown): string {
  return String(value ?? "");
}

function parseSources(value: unknown): PrivilegeSource[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<PrivilegeSource>(["direct", "inherited", "public"]);
  return value
    .map((entry) => String(entry))
    .filter((entry): entry is PrivilegeSource =>
      allowed.has(entry as PrivilegeSource),
    );
}

function parsePrivilege(value: unknown): EffectiveTablePrivilege | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const role = asString(row.role);
  const privilege = asString(row.privilege);
  const roles = new Set<string>(EXPOSED_TABLE_SECURITY_ROLES);
  const privileges = new Set<string>(INSPECTED_PRIVILEGES);
  if (!roles.has(role) || !privileges.has(privilege)) return null;
  return {
    role: role as ExposedTableSecurityRole,
    privilege: privilege as InspectedPrivilege,
    sources: parseSources(row.sources),
  };
}

function parsePrivileges(value: unknown): EffectiveTablePrivilege[] {
  if (typeof value === "string") {
    try {
      return parsePrivileges(JSON.parse(value) as unknown);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .map(parsePrivilege)
    .filter((entry): entry is EffectiveTablePrivilege => entry != null);
}

export function parseExposedTableSecurityFacts(
  rows: readonly unknown[],
): ExposedTableSecurityFact[] {
  return rows.map((row) => {
    const rec = (row ?? {}) as Record<string, unknown>;
    const schema = asString(rec.schema_name ?? rec.schema);
    const table = asString(rec.table_name ?? rec.table);
    return {
      schema,
      table,
      rlsEnabled: asBoolean(rec.rls_enabled),
      policyCount: asNumber(rec.policy_count),
      privileges: parsePrivileges(rec.privileges),
    };
  });
}

/**
 * Read-only catalog query returning one row per base/partitioned table with
 * effective PostgREST privileges. Suitable for `queryPsqlJsonRows`.
 */
export function buildInspectExposedTableSecuritySql(schema: string): string {
  return `${buildInspectExposedTableSecuritySelect(schema)};`;
}

export function buildInspectExposedTableSecuritySelect(schema: string): string {
  assertFluxApiSchemaIdentifier(schema);
  const schemaLit = sqlLiteral(schema);
  const requestRolesSql = POSTGREST_REQUEST_ROLES.map(sqlLiteral).join(", ");
  const privilegesSql = INSPECTED_PRIVILEGES.map(sqlLiteral).join(", ");

  return `
WITH tables AS (
  SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    c.oid AS table_oid,
    c.relowner,
    c.relacl,
    c.relrowsecurity AS rls_enabled,
    (
      SELECT count(*)::int
      FROM pg_catalog.pg_policy pol
      WHERE pol.polrelid = c.oid
    ) AS policy_count
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = ${schemaLit}
    AND c.relkind IN ('r', 'p')
),
evaluated AS (
  SELECT
    t.schema_name,
    t.table_name,
    r.role_name,
    p.privilege,
    CASE
      WHEN r.role_name = 'PUBLIC' THEN EXISTS (
        SELECT 1
        FROM aclexplode(t.relacl) a
        WHERE a.grantee = 0
          AND a.privilege_type = p.privilege
      )
      WHEN EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles gr
        WHERE gr.rolname = r.role_name
      ) THEN has_table_privilege(r.role_name, t.table_oid, p.privilege)
      ELSE false
    END AS effective,
    (
      (
        r.role_name <> 'PUBLIC'
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_roles own
          WHERE own.oid = t.relowner
            AND own.rolname = r.role_name
        )
      )
      OR EXISTS (
        SELECT 1
        FROM aclexplode(t.relacl) a
        JOIN pg_catalog.pg_roles gr ON gr.oid = a.grantee
        WHERE gr.rolname = r.role_name
          AND a.privilege_type = p.privilege
      )
    ) AS direct,
    EXISTS (
      SELECT 1
      FROM aclexplode(t.relacl) a
      WHERE a.grantee = 0
        AND a.privilege_type = p.privilege
    ) AS via_public
  FROM tables t
  CROSS JOIN (
    SELECT unnest(ARRAY[${requestRolesSql}]) AS role_name
    UNION ALL
    SELECT 'PUBLIC'
  ) r
  CROSS JOIN (
    SELECT unnest(ARRAY[${privilegesSql}]) AS privilege
  ) p
)
SELECT
  t.schema_name,
  t.table_name,
  t.rls_enabled,
  t.policy_count,
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'role', e.role_name,
        'privilege', e.privilege,
        'sources', CASE
          WHEN e.role_name = 'PUBLIC' THEN jsonb_build_array('public')
          ELSE COALESCE((
            SELECT jsonb_agg(src)
            FROM (
              SELECT 'direct'::text AS src WHERE e.direct
              UNION ALL
              SELECT 'public' WHERE e.via_public
              UNION ALL
              SELECT 'inherited'
              WHERE e.effective AND NOT e.direct AND NOT e.via_public
            ) src
          ), '[]'::jsonb)
        END
      )
      ORDER BY e.role_name, e.privilege
    )
    FROM evaluated e
    WHERE e.schema_name = t.schema_name
      AND e.table_name = t.table_name
      AND e.effective
  ), '[]'::jsonb) AS privileges
FROM tables t
ORDER BY t.table_name
`.trim();
}

/**
 * Transactional assertion used by v1 `flux push`. Raises `42501` only for the
 * unrestricted-write failure. Warnings use `RAISE WARNING` and do not roll back.
 */
export function buildAssertExposedTableSecuritySql(schema: string): string {
  const inspectSelect = buildInspectExposedTableSecuritySelect(schema);
  const prefixLit = sqlLiteral(UNRESTRICTED_WRITE_ERROR_PREFIX);
  const hintLit = sqlLiteral(UNRESTRICTED_WRITE_HINT);
  const warningPrefixLit = sqlLiteral(SECURITY_WARNING_PREFIX);
  const writeListSql = WRITE_PRIVILEGES.map(sqlLiteral).join(", ");

  return `DO $flux_exposed_sec$
DECLARE
  rec record;
  fail_parts text[] := ARRAY[]::text[];
  write_detail text;
  write_privs jsonb;
BEGIN
  FOR rec IN
    ${inspectSelect}
  LOOP
    SELECT coalesce(jsonb_agg(p), '[]'::jsonb)
      INTO write_privs
    FROM jsonb_array_elements(rec.privileges) AS p
    WHERE p->>'privilege' IN (${writeListSql});

    IF rec.rls_enabled IS NOT TRUE AND jsonb_array_length(write_privs) > 0 THEN
      SELECT string_agg(
        format('%s %s', p->>'role', p->>'privilege'),
        ', '
        ORDER BY p->>'role', p->>'privilege'
      )
        INTO write_detail
      FROM jsonb_array_elements(write_privs) AS p;
      fail_parts := fail_parts || format(
        '%I.%I (%s)',
        rec.schema_name,
        rec.table_name,
        coalesce(write_detail, 'write')
      );
    ELSIF rec.rls_enabled IS NOT TRUE THEN
      RAISE WARNING '% RLS disabled on %.% (%). Unrestricted reads may be intentional or sensitive; this is not an automatic migration failure.',
        ${warningPrefixLit},
        rec.schema_name,
        rec.table_name,
        CASE
          WHEN jsonb_array_length(rec.privileges) = 0
            THEN 'no effective privileges for anon, authenticated, or PUBLIC'
          ELSE 'read-only PostgREST access'
        END;
    ELSIF rec.policy_count = 0 THEN
      RAISE WARNING '% RLS enabled on %.% but no policies exist. Postgres denies non-owner access by default, so this is secure but likely unusable.',
        ${warningPrefixLit},
        rec.schema_name,
        rec.table_name;
    END IF;
  END LOOP;

  IF array_length(fail_parts, 1) IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = ${prefixLit} || ' ' || array_to_string(fail_parts, '; '),
      HINT = ${hintLit};
  END IF;
END
$flux_exposed_sec$;`;
}

/** @deprecated Use {@link buildAssertExposedTableSecuritySql}. */
export function buildAssertExposedApiSchemaHasRlsSql(schema: string): string {
  return buildAssertExposedTableSecuritySql(schema);
}

export function extractFluxSecurityWarnings(output: string): string[] {
  const lines: string[] = [];
  for (const raw of output.split(/\r?\n/u)) {
    const idx = raw.indexOf(SECURITY_WARNING_PREFIX);
    if (idx >= 0) {
      lines.push(raw.slice(idx).trim());
    }
  }
  return lines;
}

/**
 * Single-transaction v1 push body: user SQL (which may include the migration
 * ledger insert) then the exposed-table security assertion, then PostgREST
 * reload notify. The assertion runs before COMMIT so an unrestricted-write
 * failure rolls back the migration SQL and ledger write together.
 */
export function buildDedicatedPushTransactionSql(input: {
  searchPath: string;
  userSql: string;
  apiSchema: string;
}): string {
  const guardSql = buildAssertExposedTableSecuritySql(input.apiSchema);
  return `BEGIN;\nSET LOCAL search_path TO ${input.searchPath};\n${input.userSql}\n${guardSql}\nNOTIFY pgrst, 'reload schema';\nCOMMIT;\n`;
}
