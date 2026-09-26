import assert from "node:assert/strict";
import test from "node:test";
import { defaultTenantDdlRoleFromProjectId } from "./api-schema-strategy.ts";
import { assertNoDoubleStatementTerminator } from "./test/sql-assertions.ts";
import {
  BLINDED_DEFINER_AUDIT_SQL_MARKER,
  buildAssertRuntimeRoleOwnsNothingSql,
  buildForceRlsInvariantSql,
  buildInspectBlindedSecurityDefinersSql,
  formatBlindedSecurityDefinerWarnings,
  FORCE_RLS_EXEMPTION_MARKER,
  parseBlindedSecurityDefinerFindings,
  type BlindedSecurityDefinerFinding,
} from "./tenant-rls-invariants.ts";

const SCHEMA = "t_aabbccddeeff_api";
const RUNTIME_ROLE = "t_aabbccddeeff_role";

test("the DDL role is derived from the same short id as the schema and runtime role", () => {
  const projectId = "aabbccdd-eeff-4a1b-8c2d-3e4f5a6b7c8d";
  assert.equal(defaultTenantDdlRoleFromProjectId(projectId), "t_aabbccddeeff_ddl");
});

test("forcing RLS is scoped to tables that already enabled it", () => {
  const sql = buildForceRlsInvariantSql(SCHEMA);
  assert.match(sql, /c\.relrowsecurity/);
  assert.match(sql, /NOT c\.relforcerowsecurity/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, new RegExp(FORCE_RLS_EXEMPTION_MARKER));
});

test("the ownership assertion names the runtime role and raises", () => {
  const sql = buildAssertRuntimeRoleOwnsNothingSql(SCHEMA, RUNTIME_ROLE);
  assert.match(sql, /RAISE EXCEPTION/);
  assert.match(sql, new RegExp(RUNTIME_ROLE));
  assert.match(sql, /pg_get_userbyid\(c\.relowner\)/);
});

test("invariant builders reject identifiers that are not canonical tenant names", () => {
  assert.throws(() => buildForceRlsInvariantSql("public"));
  assert.throws(() => buildForceRlsInvariantSql("t_aabbccddeeff_api; DROP SCHEMA x"));
  assert.throws(() => buildAssertRuntimeRoleOwnsNothingSql(SCHEMA, "postgres"));
  assert.throws(() =>
    buildAssertRuntimeRoleOwnsNothingSql(SCHEMA, "t_aabbccddeeff_role'; DROP ROLE x --"),
  );
  assert.throws(() => buildInspectBlindedSecurityDefinersSql("public"));
  assert.throws(() =>
    buildInspectBlindedSecurityDefinersSql("t_aabbccddeeff_api'; DROP SCHEMA x --"),
  );
});

test("blinded definer audit is a catalog read, not a push rollback", () => {
  const sql = buildInspectBlindedSecurityDefinersSql(SCHEMA);
  assertNoDoubleStatementTerminator(sql);
  assert.match(sql, new RegExp(BLINDED_DEFINER_AUDIT_SQL_MARKER));
  assert.match(sql, /p\.prosecdef/);
  assert.match(sql, /NOT owner\.rolbypassrls/);
  assert.match(sql, /NOT owner\.rolsuper/);
  assert.match(sql, /c\.relforcerowsecurity/);
  assert.match(sql, /pol\.polpermissive/);
  assert.match(sql, /pol\.polcmd IN \('\*', 'r'\)/);
  assert.match(sql, /0::oid = ANY \(pol\.polroles\)/);
  assert.doesNotMatch(sql, /RAISE EXCEPTION/);
  assert.doesNotMatch(sql, /BYPASSRLS/);
  assert.doesNotMatch(sql, /NO FORCE ROW LEVEL SECURITY/);
  const outputList = sql.slice(sql.lastIndexOf("SELECT"));
  assert.doesNotMatch(outputList, /prosrc|f\.body/);
  assert.match(sql, new RegExp(SCHEMA));
});

function finding(
  overrides: Partial<BlindedSecurityDefinerFinding> = {},
): BlindedSecurityDefinerFinding {
  return {
    schema: SCHEMA,
    functionName: "read_members",
    identityArgs: "",
    ownerRole: "t_aabbccddeeff_ddl",
    tableSchema: SCHEMA,
    tableName: "members",
    ...overrides,
  };
}

test("blinded definer warnings name the helper and refuse the unsafe repairs", () => {
  const warnings = formatBlindedSecurityDefinerWarnings([finding()]);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0] ?? "", /read_members\(\)/);
  assert.match(warnings[0] ?? "", /t_aabbccddeeff_ddl/);
  assert.match(warnings[0] ?? "", /members/);
  assert.match(warnings[0] ?? "", /BYPASSRLS/);
  assert.match(warnings[0] ?? "", /FORCE ROW LEVEL SECURITY/);
  assert.match(warnings[1] ?? "", /Dynamic SQL/);
});

test("blinded definer warnings are empty when nothing is flagged", () => {
  assert.deepEqual(formatBlindedSecurityDefinerWarnings([]), []);
});

test("blinded definer parser reads catalog columns and rejects a partial row", () => {
  const parsed = parseBlindedSecurityDefinerFindings([
    {
      schema_name: SCHEMA,
      function_name: "read_members",
      identity_args: "uuid",
      owner_role: "t_aabbccddeeff_ddl",
      table_schema: SCHEMA,
      table_name: "members",
    },
  ]);
  assert.deepEqual(parsed, [finding({ identityArgs: "uuid" })]);
  assert.throws(() => parseBlindedSecurityDefinerFindings([{ function_name: "x" }]));
});
