import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy, config } from "../../proxy.ts";
import {
  applyCliRateLimitIfNeeded,
  isCliV1Path,
  isExcludedFromBroadProxyMatcher,
  matchesCliV1ProxyMatcher,
} from "./flux-proxy.ts";
import { runCliAuditPost } from "../../app/api/cli/v1/audit/route.ts";
import { runCliIntentPost } from "../../app/api/cli/v1/intents/route.ts";
import {
  resetCliRateLimitStateForTests,
  setCliRateLimitWindowsForTests,
} from "./cli-rate-limit.ts";

const AUTH = { userId: "user-1", keyId: "key-1" };

test("proxy exports a function named proxy", () => {
  assert.equal(typeof proxy, "function");
  assert.equal(proxy.name, "proxy");
});

test("proxy config matches CLI v1 and broad dashboard paths", () => {
  assert.ok(Array.isArray(config.matcher));
  assert.ok(config.matcher.some((m) => m.includes("/api/cli/v1")));
});

test("isCliV1Path identifies CLI control-plane routes", () => {
  assert.equal(isCliV1Path("/api/cli/v1/audit"), true);
  assert.equal(isCliV1Path("/api/cli/v1/intents/abc"), true);
  assert.equal(isCliV1Path("/api/cli/v1/list"), true);
  assert.equal(isCliV1Path("/api/projects/demo"), false);
  assert.equal(isCliV1Path("/projects"), false);
});

test("applyCliRateLimitIfNeeded rate-limits CLI routes only", () => {
  resetCliRateLimitStateForTests();
  setCliRateLimitWindowsForTests({ write: { limit: 1, windowMs: 60_000 } });

  const cliReq = new NextRequest("http://test/api/cli/v1/create", {
    method: "POST",
    headers: { Authorization: "Bearer flx_live_0123456789abcdef0123456789abcdef_abcd" },
  });
  assert.equal(applyCliRateLimitIfNeeded(cliReq), null);
  const blocked = applyCliRateLimitIfNeeded(cliReq);
  assert.ok(blocked);
  assert.equal(blocked!.status, 429);

  const dashboardReq = new NextRequest("http://test/projects", { method: "GET" });
  assert.equal(applyCliRateLimitIfNeeded(dashboardReq), null);

  const authReq = new NextRequest("http://test/api/auth/session", { method: "GET" });
  assert.equal(applyCliRateLimitIfNeeded(authReq), null);
});

test("CLI v1 matcher paths include audit and intents", () => {
  assert.equal(matchesCliV1ProxyMatcher("/api/cli/v1/audit"), true);
  assert.equal(matchesCliV1ProxyMatcher("/api/cli/v1/intents"), true);
  assert.equal(matchesCliV1ProxyMatcher("/api/cli/v1/intents/abc-123"), true);
  assert.equal(matchesCliV1ProxyMatcher("/api/cli/v1/list"), true);
});

test("broad matcher excludes api/cli and static assets", () => {
  assert.equal(isExcludedFromBroadProxyMatcher("/api/cli/v1/list"), true);
  assert.equal(isExcludedFromBroadProxyMatcher("/api/cli/v1/audit"), true);
  assert.equal(isExcludedFromBroadProxyMatcher("/_next/static/chunk.js"), true);
  assert.equal(isExcludedFromBroadProxyMatcher("/projects"), false);
  assert.equal(isExcludedFromBroadProxyMatcher("/api/auth/session"), false);
  assert.equal(isExcludedFromBroadProxyMatcher("/api/projects/demo"), false);
});

test("audit route reachable when proxy rate limit allows POST", async () => {
  resetCliRateLimitStateForTests();
  const body = JSON.stringify({
    tool: "flux.project.list",
    intentClass: "read",
    decision: "allow",
    requestSummary: {},
    resultStatus: "ok",
    durationMs: 1,
  });
  const req = new NextRequest("http://test/api/cli/v1/audit", {
    method: "POST",
    headers: { Authorization: "Bearer flx_live_test", "Content-Type": "application/json" },
    body,
  });
  assert.equal(applyCliRateLimitIfNeeded(req), null);

  const res = await runCliAuditPost(
    new Request("http://test/api/cli/v1/audit", {
      method: "POST",
      headers: { Authorization: "Bearer flx_live_test", "Content-Type": "application/json" },
      body,
    }),
    {
      initSystemDb: async () => undefined,
      getDb: () =>
        ({
          insert: () => ({
            values: () => ({
              returning: async () => [{ id: "audit-proxy-1" }],
            }),
          }),
        }) as never,
      authenticate: async () => AUTH,
    },
  );
  assert.equal(res.status, 200);
});

test("intent route reachable when proxy rate limit allows POST", async () => {
  resetCliRateLimitStateForTests();
  const body = JSON.stringify({
    tool: "flux.migration.plan",
    intentClass: "plan",
    status: "completed",
    riskLevel: "medium",
    policyDecision: "allow",
    projectHash: "abc1234",
    requestSummary: { hash: "abc1234" },
  });
  const req = new NextRequest("http://test/api/cli/v1/intents", {
    method: "POST",
    headers: { Authorization: "Bearer flx_live_test", "Content-Type": "application/json" },
    body,
  });
  assert.equal(applyCliRateLimitIfNeeded(req), null);

  const res = await runCliIntentPost(
    new Request("http://test/api/cli/v1/intents", {
      method: "POST",
      headers: { Authorization: "Bearer flx_live_test", "Content-Type": "application/json" },
      body,
    }),
    {
      initSystemDb: async () => undefined,
      getDb: () =>
        ({
          select: () => ({
            from: () => ({
              where: () => ({
                limit: async () => [{ id: "00000000-0000-4000-8000-000000000099" }],
              }),
            }),
          }),
          insert: () => ({
            values: () => ({
              returning: async () => [{ id: "intent-proxy-1", status: "completed" }],
            }),
          }),
        }) as never,
      authenticate: async () => AUTH,
    },
  );
  assert.equal(res.status, 200);
});
