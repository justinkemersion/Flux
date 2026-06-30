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
