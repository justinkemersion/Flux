import { test } from "node:test";
import assert from "node:assert/strict";
import { fail, InvalidInputError, ok, toStableError } from "./result";

test("ok builds a successful envelope without remediation", () => {
  const r = ok("done", { a: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.summary, "done");
  assert.deepEqual(r.data, { a: 1 });
  assert.equal("remediation" in r, false);
});

test("ok includes remediation when provided", () => {
  const r = ok("blocked", { allowed: false }, "do x");
  assert.equal(r.remediation, "do x");
});

test("fail defaults data to null and marks ok false", () => {
  const r = fail("boom");
  assert.equal(r.ok, false);
  assert.equal(r.data, null);
  assert.equal("remediation" in r, false);
});

test("toStableError maps InvalidInputError", () => {
  assert.equal(toStableError(new InvalidInputError("x")).code, "invalid_input");
});

test("toStableError maps not-authenticated with remediation", () => {
  const e = toStableError(
    new Error("Not authenticated. Set FLUX_API_TOKEN or run `flux login`."),
  );
  assert.equal(e.code, "not_authenticated");
  assert.ok(e.remediation);
});

test("toStableError maps expired token to unauthorized", () => {
  const e = toStableError(
    new Error("Invalid or expired API token. Run `flux login`."),
  );
  assert.equal(e.code, "unauthorized");
});

test("toStableError defaults unknown errors to upstream_error", () => {
  assert.equal(toStableError(new Error("weird")).code, "upstream_error");
});
