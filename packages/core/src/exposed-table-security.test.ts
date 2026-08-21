import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssertExposedTableSecuritySql,
  buildInspectExposedTableSecuritySql,
  classifyExposedSchemaSecurity,
  classifyExposedTableSecurity,
  extractFluxSecurityWarnings,
  formatUnrestrictedWriteError,
  isUnrestrictedWritePushError,
  parseExposedTableSecurityFacts,
  SECURITY_WARNING_PREFIX,
  UNRESTRICTED_WRITE_ERROR_PREFIX,
  type EffectiveTablePrivilege,
  type ExposedTableSecurityFact,
} from "./exposed-table-security.ts";
import { assertNoDoubleStatementTerminator } from "./test/sql-assertions.ts";

function priv(
  role: EffectiveTablePrivilege["role"],
  privilege: EffectiveTablePrivilege["privilege"],
  sources: EffectiveTablePrivilege["sources"] = ["direct"],
): EffectiveTablePrivilege {
  return { role, privilege, sources };
}

function fact(
  overrides: Partial<ExposedTableSecurityFact> & Pick<ExposedTableSecurityFact, "table">,
): ExposedTableSecurityFact {
  return {
    schema: "api",
    rlsEnabled: true,
    policyCount: 1,
    privileges: [],
    ...overrides,
  };
}

test("hard failure: RLS disabled and anon has direct write privileges", () => {
  const finding = classifyExposedTableSecurity(
    fact({
      table: "mail_categories",
      rlsEnabled: false,
      policyCount: 0,
      privileges: [priv("anon", "INSERT"), priv("anon", "UPDATE"), priv("anon", "DELETE")],
    }),
  );
  assert.equal(finding.severity, "fail");
  assert.equal(finding.code, "unrestricted_write");
  assert.match(finding.message, /mail_categories/u);
  assert.match(finding.message, /anon/u);
  assert.match(finding.message, /INSERT/u);
});

test("hard failure: write privileges inherited through role membership", () => {
  const finding = classifyExposedTableSecurity(
    fact({
      table: "events",
      rlsEnabled: false,
      policyCount: 0,
      privileges: [priv("anon", "INSERT", ["inherited"])],
    }),
  );
  assert.equal(finding.severity, "fail");
  assert.match(finding.message, /inherited role membership/u);
});

test("hard failure: write privileges granted through PUBLIC", () => {
  const finding = classifyExposedTableSecurity(
    fact({
      table: "docs",
      rlsEnabled: false,
      policyCount: 0,
      privileges: [
        priv("PUBLIC", "INSERT", ["public"]),
        priv("anon", "INSERT", ["public"]),
      ],
    }),
  );
  assert.equal(finding.severity, "fail");
  assert.match(finding.message, /PUBLIC/u);
  assert.match(finding.message, /INSERT/u);
});

test("pass: RLS enabled with applicable policies", () => {
  const finding = classifyExposedTableSecurity(
    fact({
      table: "notes",
      rlsEnabled: true,
      policyCount: 2,
      privileges: [priv("authenticated", "INSERT"), priv("authenticated", "SELECT")],
    }),
  );
  assert.equal(finding.severity, "pass");
  assert.equal(finding.code, "ok");
});

test("warning: RLS enabled with zero policies does not fail", () => {
  const finding = classifyExposedTableSecurity(
    fact({
      table: "queue",
      rlsEnabled: true,
      policyCount: 0,
      privileges: [priv("anon", "INSERT")],
    }),
  );
  assert.equal(finding.severity, "warn");
  assert.equal(finding.code, "rls_enabled_without_policies");
});

test("warning: RLS disabled with read-only access", () => {
  const finding = classifyExposedTableSecurity(
    fact({
      table: "public_copy",
      rlsEnabled: false,
      policyCount: 0,
      privileges: [priv("anon", "SELECT")],
    }),
  );
  assert.equal(finding.severity, "warn");
  assert.equal(finding.code, "rls_disabled_read");
  assert.match(finding.message, /intentional or sensitive/u);
});

test("internal or ungranted table does not generate a hard failure", () => {
  const finding = classifyExposedTableSecurity(
    fact({
      table: "internal_queue",
      rlsEnabled: false,
      policyCount: 0,
      privileges: [],
    }),
  );
  assert.equal(finding.severity, "warn");
  assert.notEqual(finding.severity, "fail");
  assert.match(finding.message, /no effective privileges/u);
});

test("schema report fails only when any table has unrestricted writes", () => {
  const report = classifyExposedSchemaSecurity([
    fact({
      table: "mail_categories",
      rlsEnabled: false,
      privileges: [priv("anon", "INSERT"), priv("authenticated", "DELETE")],
    }),
    fact({
      table: "queue",
      rlsEnabled: true,
      policyCount: 0,
    }),
    fact({
      table: "notes",
      rlsEnabled: true,
      policyCount: 1,
    }),
  ]);
  assert.equal(report.overall, "fail");
  assert.equal(report.failures.length, 1);
  assert.equal(report.warnings.length, 1);
  const error = formatUnrestrictedWriteError(report.failures);
  assert.match(error, /Refusing push: unrestricted write/u);
  assert.match(error, /mail_categories/u);
  assert.match(error, /anon/u);
  assert.match(error, /INSERT/u);
  assert.equal(isUnrestrictedWritePushError(error), true);
});

test("inspect SQL uses effective privilege checks, not ACL text alone", () => {
  const sql = buildInspectExposedTableSecuritySql("api");
  assert.match(sql, /has_table_privilege/u);
  assert.match(sql, /aclexplode/u);
  assert.match(sql, /grantee = 0/u);
  assert.match(sql, /'inherited'/u);
  assert.match(sql, /'anon'/u);
  assert.match(sql, /'authenticated'/u);
  assert.match(sql, /'PUBLIC'/u);
  assert.match(sql, /INSERT/u);
  assert.match(sql, /TRUNCATE/u);
  assert.doesNotMatch(sql, /information_schema\.role_table_grants/u);
  assertNoDoubleStatementTerminator(sql);
});

test("assert SQL raises unrestricted-write failures and warns otherwise", () => {
  const sql = buildAssertExposedTableSecuritySql("api");
  assert.match(sql, /has_table_privilege/u);
  assert.match(sql, /\$flux_exposed_sec\$/u);
  assert.match(sql, new RegExp(UNRESTRICTED_WRITE_ERROR_PREFIX.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(sql, /RAISE WARNING/u);
  assert.match(sql, /ERRCODE = '42501'/u);
  assert.match(sql, /does not change the schema automatically/u);
  assert.doesNotMatch(sql, /Refusing push: exposed API table\(s\) have row level security disabled/u);
  assert.doesNotMatch(sql, /have row level security enabled but no policies/u);
  assertNoDoubleStatementTerminator(sql);
});

test("assert SQL validates the schema identifier", () => {
  assert.throws(() => buildAssertExposedTableSecuritySql("api; DROP SCHEMA public"));
});

test("parseExposedTableSecurityFacts reads JSON rows from the inspect query", () => {
  const facts = parseExposedTableSecurityFacts([
    {
      schema_name: "api",
      table_name: "mail_categories",
      rls_enabled: false,
      policy_count: 0,
      privileges: [
        { role: "anon", privilege: "INSERT", sources: ["direct"] },
      ],
    },
  ]);
  assert.equal(facts[0]?.table, "mail_categories");
  assert.equal(facts[0]?.rlsEnabled, false);
  assert.equal(facts[0]?.privileges[0]?.role, "anon");
});

test("extractFluxSecurityWarnings keeps only Flux warning lines", () => {
  const warnings = extractFluxSecurityWarnings(
    [
      "NOTICE:  hello",
      `WARNING:  ${SECURITY_WARNING_PREFIX} RLS disabled on api.docs (read-only PostgREST access)`,
      "COMMIT",
    ].join("\n"),
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /api\.docs/u);
});
