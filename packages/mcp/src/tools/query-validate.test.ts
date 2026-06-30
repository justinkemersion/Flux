import { test } from "node:test";
import assert from "node:assert/strict";
import { validateReadonlyQuery } from "./query-validate";

test("accepts a simple SELECT and wraps with a bounded LIMIT", () => {
  const { wrapped, cap } = validateReadonlyQuery("SELECT 1", { rowCap: 50 });
  assert.equal(cap, 50);
  assert.match(wrapped, /^SELECT \* FROM \(/);
  assert.match(wrapped, /LIMIT 51$/);
});

test("accepts a WITH (CTE) query", () => {
  const { wrapped } = validateReadonlyQuery(
    "WITH t AS (SELECT 1 AS n) SELECT n FROM t",
    { rowCap: 10 },
  );
  assert.match(wrapped, /flux_readonly/);
  assert.match(wrapped, /LIMIT 11$/);
});

test("tolerates a single trailing semicolon", () => {
  assert.doesNotThrow(() => validateReadonlyQuery("SELECT 1;"));
});

test("rejects multi-statement SQL", () => {
  assert.throws(
    () => validateReadonlyQuery("SELECT 1; SELECT 2"),
    /single SQL statement/,
  );
});

test("rejects non-SELECT/WITH start", () => {
  assert.throws(() => validateReadonlyQuery("TABLE products"), /SELECT or WITH/);
});

for (const sql of [
  "INSERT INTO t VALUES (1)",
  "UPDATE t SET x = 1",
  "DELETE FROM t",
  "DROP TABLE t",
  "ALTER TABLE t ADD COLUMN x int",
  "CREATE TABLE t (id int)",
  "GRANT SELECT ON t TO r",
  "REVOKE SELECT ON t FROM r",
  "TRUNCATE t",
  "COPY t FROM '/x'",
  "CALL proc()",
  "DO $$ BEGIN END $$",
  "MERGE INTO t USING s ON t.id = s.id",
]) {
  test(`rejects mutation/privileged SQL: ${sql.slice(0, 24)}`, () => {
    assert.throws(() => validateReadonlyQuery(sql));
  });
}

test("rejects SECURITY DEFINER", () => {
  assert.throws(
    () => validateReadonlyQuery("SELECT 1 SECURITY DEFINER"),
    /SECURITY DEFINER/,
  );
});

test("rejects a mutation hidden after a comment", () => {
  // Comment stripping reveals the mutation, which is then rejected.
  assert.throws(() => validateReadonlyQuery("-- harmless\nDELETE FROM t"));
});

test("rejects a data-modifying CTE that starts with WITH", () => {
  assert.throws(
    () =>
      validateReadonlyQuery(
        "WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x",
      ),
    /non-read or privileged/,
  );
});

test("rejects empty / comment-only input", () => {
  assert.throws(() => validateReadonlyQuery("   "), /Missing required string/);
  assert.throws(() => validateReadonlyQuery("-- just a comment"), /empty/);
});

test("clamps row cap to the maximum", () => {
  const { cap } = validateReadonlyQuery("SELECT 1", { rowCap: 999999 });
  assert.equal(cap, 1000);
});

test("does not false-positive on read columns containing keyword substrings", () => {
  // created_at / updated_at must not trip the create/update keyword filter.
  assert.doesNotThrow(() =>
    validateReadonlyQuery("SELECT created_at, updated_at FROM products"),
  );
});
