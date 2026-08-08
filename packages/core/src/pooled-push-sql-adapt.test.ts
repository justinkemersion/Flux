import test from "node:test";
import assert from "node:assert/strict";
import { adaptPooledPushSql } from "./pooled-push-sql-adapt.ts";

const SCHEMA = "t_5ecfa3ab72d1_api";
const ROLE = "t_5ecfa3ab72d1_role";
const ADAPT = { tenantSchema: SCHEMA, tenantRole: ROLE };

test("adaptPooledPushSql maps GRANT TO authenticated to tenant role", () => {
  const sql = `
CREATE TABLE profiles (id uuid PRIMARY KEY);
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO authenticated;
`;
  const out = adaptPooledPushSql(sql, ADAPT);
  assert.match(out, /GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO "t_5ecfa3ab72d1_role"/);
  assert.doesNotMatch(out, /\bauthenticated\b/i);
});

test("adaptPooledPushSql maps GRANT ON SCHEMA public to tenant schema", () => {
  const sql = "GRANT USAGE ON SCHEMA public TO authenticated;";
  const out = adaptPooledPushSql(sql, ADAPT);
  assert.match(out, /GRANT USAGE ON SCHEMA "t_5ecfa3ab72d1_api" TO "t_5ecfa3ab72d1_role"/);
});

test("adaptPooledPushSql rewrites ALTER DEFAULT PRIVILEGES for authenticated", () => {
  const sql =
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;";
  const out = adaptPooledPushSql(sql, ADAPT);
  assert.match(out, /IN SCHEMA "t_5ecfa3ab72d1_api"/);
  assert.match(out, /TO "t_5ecfa3ab72d1_role"/);
});

test("adaptPooledPushSql rewrites CREATE POLICY TO authenticated", () => {
  const sql = `
CREATE POLICY profiles_self ON profiles
  FOR ALL TO authenticated
  USING (auth.uid() = user_id);
`;
  const out = adaptPooledPushSql(sql, ADAPT);
  assert.match(out, /FOR ALL TO "t_5ecfa3ab72d1_role"/);
});

test("adaptPooledPushSql preserves anon grants", () => {
  const sql = "GRANT SELECT ON profiles TO anon, authenticated;";
  const out = adaptPooledPushSql(sql, ADAPT);
  assert.match(out, /TO anon, "t_5ecfa3ab72d1_role"/);
});

test("adaptPooledPushSql leaves unqualified CREATE TABLE unchanged", () => {
  const sql = "CREATE TABLE IF NOT EXISTS profiles (id uuid PRIMARY KEY);";
  assert.equal(adaptPooledPushSql(sql, ADAPT), sql);
});

test("adaptPooledPushSql leaves qualified public objects alone", () => {
  const sql =
    "CREATE TABLE items (id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(), tag public.citext);";
  assert.equal(adaptPooledPushSql(sql, ADAPT), sql);
});

/**
 * Lexical safety: adaptation must only ever touch executable SQL. Each case below
 * pairs a rewrite that must happen with the same token in a context that must not
 * be rewritten, so a regression in the scanner cannot pass by weakening both.
 */

test("adaptPooledPushSql rewrites the canonical parent-ownership policy", () => {
  const sql = `CREATE POLICY notes_select ON notes FOR SELECT TO authenticated
  USING (
    exists (
      select 1 from records r
      where r.id = record_id
        and r.user_id = (current_setting('request.jwt.claims', true)::json->>'sub')
    )
  );`;
  const out = adaptPooledPushSql(sql, ADAPT);
  assert.match(out, /FOR SELECT TO "t_5ecfa3ab72d1_role"/);
  assert.match(out, /current_setting\('request\.jwt\.claims', true\)/);
});

test("adaptPooledPushSql leaves line comments unchanged", () => {
  const sql = "-- grant authenticated to something\nCREATE TABLE t (id uuid);";
  assert.equal(adaptPooledPushSql(sql, ADAPT), sql);
});

test("adaptPooledPushSql leaves block comments unchanged", () => {
  const sql = "/* TO authenticated */\nCREATE TABLE t (id uuid);";
  assert.equal(adaptPooledPushSql(sql, ADAPT), sql);
});

test("adaptPooledPushSql leaves nested block comments unchanged", () => {
  const sql = "/* outer /* GRANT ALL TO authenticated */ still comment */\nCREATE TABLE t (id uuid);";
  assert.equal(adaptPooledPushSql(sql, ADAPT), sql);
});

test("adaptPooledPushSql leaves dynamic SQL string contents unchanged", () => {
  const sql = "EXECUTE format('grant authenticated to %I', tenant_role);";
  assert.equal(adaptPooledPushSql(sql, ADAPT), sql);
});

test("adaptPooledPushSql leaves ordinary string literals unchanged", () => {
  const sql = "SELECT 'authenticated';";
  assert.equal(adaptPooledPushSql(sql, ADAPT), sql);
});

test("adaptPooledPushSql leaves escaped quotes inside literals unchanged", () => {
  const sql = "SELECT 'it''s authenticated', E'esc\\' authenticated';";
  assert.equal(adaptPooledPushSql(sql, ADAPT), sql);
});

test("adaptPooledPushSql leaves dollar-quoted bodies unchanged", () => {
  const sql = `DO $$
BEGIN
  EXECUTE 'grant authenticated to something';
END
$$;`;
  assert.equal(adaptPooledPushSql(sql, ADAPT), sql);
});

test("adaptPooledPushSql leaves tagged dollar quotes unchanged", () => {
  const sql = "SELECT $migration$ TO authenticated; ON SCHEMA public $migration$;";
  assert.equal(adaptPooledPushSql(sql, ADAPT), sql);
});

test("adaptPooledPushSql leaves quoted identifiers unchanged", () => {
  const sql = 'GRANT SELECT ON "authenticated" TO authenticated;';
  const out = adaptPooledPushSql(sql, ADAPT);
  assert.match(out, /ON "authenticated" TO "t_5ecfa3ab72d1_role"/);
});

test("adaptPooledPushSql rewrites only executable tokens in a mixed migration", () => {
  const sql = `-- historical note: we used to grant authenticated to the tenant role
/* legacy: ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated */
DO $$
DECLARE tenant_role text := current_user;
BEGIN
  EXECUTE format('grant authenticated to %I', tenant_role);
END
$$;
CREATE POLICY notes_all ON notes FOR ALL TO authenticated USING (true);
SELECT 'authenticated' AS label;`;
  const out = adaptPooledPushSql(sql, ADAPT);
  assert.equal(
    out,
    sql.replace("FOR ALL TO authenticated", 'FOR ALL TO "t_5ecfa3ab72d1_role"'),
  );
});

test("adaptPooledPushSql does not let a semicolon inside a literal split statements", () => {
  const sql = "SELECT 'a; authenticated' AS x, 'b' AS y;";
  assert.equal(adaptPooledPushSql(sql, ADAPT), sql);
});

test("adaptPooledPushSql does not arm a rewrite from a keyword inside a literal", () => {
  const sql = "INSERT INTO audit (note) VALUES ('GRANT ALL TO authenticated');";
  assert.equal(adaptPooledPushSql(sql, ADAPT), sql);
});

test("adaptPooledPushSql rewrites across an interleaved comment", () => {
  const sql = "GRANT USAGE ON SCHEMA public /* tenant */ TO authenticated;";
  const out = adaptPooledPushSql(sql, ADAPT);
  assert.match(
    out,
    /GRANT USAGE ON SCHEMA "t_5ecfa3ab72d1_api" \/\* tenant \*\/ TO "t_5ecfa3ab72d1_role"/,
  );
});

test("adaptPooledPushSql adapts the Foundry 0.6.0 canonical corpus shape", () => {
  const sql = `grant select, insert, update, delete on table records to authenticated;

-- Tighten notes / record_tags so rows cannot attach to another tenant's record.
-- Parent ownership: JWT sub must own the referenced records row (when record_id is set).
drop policy if exists record_tags_select on record_tags;
create policy record_tags_select on record_tags for select to authenticated using (
  (current_setting('request.jwt.claims', true)::json->>'sub') = user_id
  and exists (
    select 1 from records r
    where r.id = record_id
      and r.user_id = (current_setting('request.jwt.claims', true)::json->>'sub')
  )
);`;
  const out = adaptPooledPushSql(sql, ADAPT);
  assert.equal(
    out,
    sql
      .replace("on table records to authenticated", 'on table records to "t_5ecfa3ab72d1_role"')
      .replace(
        "for select to authenticated using",
        'for select to "t_5ecfa3ab72d1_role" using',
      ),
  );
});

test("adaptPooledPushSql is idempotent", () => {
  const sql = `GRANT USAGE ON SCHEMA public TO authenticated;
CREATE POLICY p ON notes FOR ALL TO authenticated USING (true);
-- grant authenticated to nobody`;
  const once = adaptPooledPushSql(sql, ADAPT);
  assert.equal(adaptPooledPushSql(once, ADAPT), once);
});
