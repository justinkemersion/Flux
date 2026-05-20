import test from "node:test";
import assert from "node:assert/strict";
import { buildBackupVerifyPreRestoreSql } from "./backup-verify-pre-restore-sql.ts";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";

test("buildBackupVerifyPreRestoreSql includes platform and tenant roles for tenant_export", () => {
  const sql = buildBackupVerifyPreRestoreSql({
    projectId: PROJECT_ID,
    kind: "tenant_export",
  });
  assert.match(sql, /CREATE ROLE anon NOLOGIN NOINHERIT/u);
  assert.match(sql, /CREATE ROLE authenticated NOLOGIN NOINHERIT/u);
  assert.match(sql, /CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS/u);
  assert.match(sql, /CREATE ROLE authenticator NOLOGIN NOINHERIT/u);
  assert.match(sql, /CREATE ROLE t_550e8400e29b_role NOLOGIN NOINHERIT/u);
  assert.match(sql, /GRANT anon, authenticated, service_role TO authenticator/u);
});

test("buildBackupVerifyPreRestoreSql includes tenant role for project_db", () => {
  const sql = buildBackupVerifyPreRestoreSql({
    projectId: PROJECT_ID,
    kind: "project_db",
  });
  assert.match(sql, /CREATE ROLE t_550e8400e29b_role NOLOGIN NOINHERIT/u);
});
