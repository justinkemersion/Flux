import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuditLine, emitAudit, redactValue } from "./audit";

test("redactValue scrubs sensitive keys recursively", () => {
  const out = redactValue({
    token: "abc",
    password: "p",
    jwtSecret: "s",
    serviceRoleKey: "k",
    hash: "deadbee",
    nested: { authorization: "Bearer x", ok: 1 },
  }) as Record<string, unknown>;

  assert.equal(out.token, "[redacted]");
  assert.equal(out.password, "[redacted]");
  assert.equal(out.jwtSecret, "[redacted]");
  assert.equal(out.serviceRoleKey, "[redacted]");
  assert.equal(out.hash, "deadbee");
  const nested = out.nested as Record<string, unknown>;
  assert.equal(nested.authorization, "[redacted]");
  assert.equal(nested.ok, 1);
});

test("redactValue redacts JWT and postgres connection strings in values", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc123signature";
  const conn = "postgres://admin:secret@db.internal:5432/app";
  assert.equal(redactValue(jwt), "[redacted]");
  assert.equal(redactValue(conn), "[redacted]");
});

test("redactValue redacts path-like backup storage strings in values", () => {
  assert.equal(redactValue("/srv/flux/backups/proj/b1.dump"), "[redacted]");
  assert.equal(redactValue("restore_verified"), "restore_verified");
});

test("redactValue truncates very long strings", () => {
  const out = redactValue("x".repeat(500)) as string;
  assert.ok(out.length < 300);
  assert.ok(out.endsWith("[truncated]"));
});

test("buildAuditLine produces single-line JSON with redacted args", () => {
  const line = buildAuditLine({
    tool: "flux.doctor",
    intentClass: "read",
    decision: "allow",
    status: "ok",
    durationMs: 5,
    args: { hash: "abc", token: "secret-value" },
  });

  assert.equal(line.includes("\n"), false);
  const parsed = JSON.parse(line) as {
    tool: string;
    event: string;
    args: Record<string, unknown>;
  };
  assert.equal(parsed.tool, "flux.doctor");
  assert.equal(parsed.event, "flux_mcp_tool_call");
  assert.equal(parsed.args.token, "[redacted]");
  assert.equal(parsed.args.hash, "abc");
});

test("redactValue scrubs temporary DB credential material (field-level)", () => {
  const out = redactValue({
    username: "flux_temp_ro_abc1234_deadbeef",
    password: "super-secret-temp-password",
    access: "readonly",
    tenantSchema: "t_abc123456789_api",
  }) as Record<string, unknown>;

  assert.equal(out.username, "flux_temp_ro_abc1234_deadbeef");
  assert.equal(out.access, "readonly");
  assert.equal(out.password, "[redacted]");
  assert.equal(
    JSON.stringify(out).includes("super-secret-temp-password"),
    false,
  );
});

test("redactValue redacts a whole credential object under a credential key", () => {
  const out = redactValue({
    credential: { username: "u", password: "p" },
  }) as Record<string, unknown>;
  assert.equal(out.credential, "[redacted]");
});

test("emitAudit writes exactly one line", () => {
  const lines: string[] = [];
  emitAudit(
    {
      tool: "t",
      intentClass: "read",
      decision: "allow",
      status: "ok",
      durationMs: 1,
      args: {},
    },
    (line) => lines.push(line),
  );
  assert.equal(lines.length, 1);
});
