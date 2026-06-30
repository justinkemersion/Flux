import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  acquireCliRateSlot,
  classifyCliRoute,
  cliRateLimitResponse,
  resetCliRateLimitStateForTests,
  setCliRateLimitStorageAvailable,
  setCliRateLimitWindowsForTests,
} from "./cli-rate-limit.ts";

test("classifyCliRoute marks audit POST separately from writes", () => {
  assert.equal(classifyCliRoute("/api/cli/v1/audit", "POST"), "audit");
  assert.equal(classifyCliRoute("/api/cli/v1/list", "GET"), "read");
  assert.equal(classifyCliRoute("/api/cli/v1/push", "POST"), "sensitive");
  assert.equal(classifyCliRoute("/api/cli/v1/create", "POST"), "write");
});

test("rate limiter returns stable 429 on burst", () => {
  resetCliRateLimitStateForTests();
  setCliRateLimitWindowsForTests({ write: { limit: 2, windowMs: 60_000 } });
  const req = new NextRequest("http://test/api/cli/v1/create", {
    method: "POST",
    headers: { Authorization: "Bearer flx_live_0123456789abcdef0123456789abcdef_abcd" },
  });

  assert.equal(cliRateLimitResponse(req), null);
  assert.equal(cliRateLimitResponse(req), null);
  const res = cliRateLimitResponse(req);
  assert.ok(res);
  assert.equal(res!.status, 429);
});

test("rate limiter does not affect non-CLI dashboard routes", () => {
  resetCliRateLimitStateForTests();
  setCliRateLimitWindowsForTests({ read: { limit: 1, windowMs: 60_000 } });
  acquireCliRateSlot("dashboard-user", "read");

  const req = new NextRequest("http://test/api/projects/demo", { method: "GET" });
  assert.equal(cliRateLimitResponse(req), null);
});

test("write tier fails closed when storage unavailable", () => {
  resetCliRateLimitStateForTests();
  setCliRateLimitStorageAvailable(false);
  const blocked = acquireCliRateSlot("key-b", "write");
  assert.equal(blocked.allowed, false);
});

test("read tier fails open when storage unavailable", () => {
  resetCliRateLimitStateForTests();
  setCliRateLimitStorageAvailable(false);
  const allowed = acquireCliRateSlot("key-c", "read");
  assert.equal(allowed.allowed, true);
});
