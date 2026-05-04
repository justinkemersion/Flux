import test from "node:test";
import assert from "node:assert/strict";
import {
  POOLED_PUSH_MAX_SQL_BYTES,
  extractPooledPushBearer,
  isValidFluxProjectHash,
  parsePooledPushJsonBody,
  tenantApiSchemaFromProjectId,
  validatePooledPushServiceRole,
  validatePooledPushSqlPayload,
} from "./pooled-push-validators";

test("extractPooledPushBearer accepts Bearer token", () => {
  assert.equal(
    extractPooledPushBearer("  Bearer abc.def.ghi  "),
    "abc.def.ghi",
  );
  assert.equal(extractPooledPushBearer("Basic x"), null);
  assert.equal(extractPooledPushBearer("Bearer "), null);
  assert.equal(extractPooledPushBearer(null), null);
});

test("isValidFluxProjectHash enforces length and lowercase hex", () => {
  assert.equal(isValidFluxProjectHash("4f9aeaa"), true);
  assert.equal(isValidFluxProjectHash("4F9AEAA"), false);
  assert.equal(isValidFluxProjectHash("4f9aeaa0"), false);
  assert.equal(isValidFluxProjectHash("g9aeaaa"), false);
});

test("parsePooledPushJsonBody normalizes hash and rejects bad shapes", () => {
  assert.deepEqual(parsePooledPushJsonBody({ hash: "  AbCdEf0 ", sql: "select 1" }), {
    ok: true,
    hash: "abcdef0",
    sql: "select 1",
  });
  const bad = parsePooledPushJsonBody({ hash: "4f9aeaa", sql: 1 });
  assert.equal(bad.ok, false);
  if (bad.ok === false) {
    assert.match(bad.error, /hash.*sql/);
  }
});

test("validatePooledPushSqlPayload rejects empty and oversized sql", () => {
  assert.deepEqual(validatePooledPushSqlPayload("", POOLED_PUSH_MAX_SQL_BYTES), {
    ok: false,
    error: "sql is empty",
    status: 400,
  });
  const sql = "x".repeat(100);
  assert.deepEqual(validatePooledPushSqlPayload(sql, 50), {
    ok: false,
    error: "sql exceeds maximum size",
    status: 413,
  });
  assert.deepEqual(validatePooledPushSqlPayload("ok", POOLED_PUSH_MAX_SQL_BYTES), {
    ok: true,
  });
});

test("validatePooledPushServiceRole requires service_role", () => {
  assert.deepEqual(validatePooledPushServiceRole({ role: "service_role" }), {
    ok: true,
  });
  const r = validatePooledPushServiceRole({ role: "authenticated" });
  assert.equal(r.ok, false);
  if (r.ok === false) assert.match(r.error, /service_role/);
});

test("tenantApiSchemaFromProjectId derives t_<shortId>_api", () => {
  const id = "5ecfa3ab-72d1-4b3a-9c8e-111111111111";
  assert.deepEqual(tenantApiSchemaFromProjectId(id), {
    ok: true,
    schema: "t_5ecfa3ab72d1_api",
  });
});
