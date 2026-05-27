import test from "node:test";
import assert from "node:assert/strict";
import { isCliAdmin, resolveCliRole } from "./cli-audience";

test("resolveCliRole defaults to operator", () => {
  const prev = process.env.FLUX_CLI_VERBOSE;
  const prevEmails = process.env.FLUX_CLI_ADMIN_EMAILS;
  delete process.env.FLUX_CLI_VERBOSE;
  delete process.env.FLUX_CLI_ADMIN_EMAILS;
  try {
    assert.equal(resolveCliRole(undefined), "operator");
    assert.equal(resolveCliRole({ plan: "hobby", defaultMode: "v2_shared" }), "operator");
  } finally {
    if (prev === undefined) delete process.env.FLUX_CLI_VERBOSE;
    else process.env.FLUX_CLI_VERBOSE = prev;
    if (prevEmails === undefined) delete process.env.FLUX_CLI_ADMIN_EMAILS;
    else process.env.FLUX_CLI_ADMIN_EMAILS = prevEmails;
  }
});

test("resolveCliRole honors server profile cliRole admin", () => {
  assert.equal(
    resolveCliRole({
      plan: "pro",
      defaultMode: "v2_shared",
      cliRole: "admin",
      user: "justin@example.com",
    }),
    "admin",
  );
});

test("FLUX_CLI_VERBOSE forces admin locally", () => {
  const prev = process.env.FLUX_CLI_VERBOSE;
  process.env.FLUX_CLI_VERBOSE = "1";
  try {
    assert.equal(isCliAdmin(undefined), true);
  } finally {
    if (prev === undefined) delete process.env.FLUX_CLI_VERBOSE;
    else process.env.FLUX_CLI_VERBOSE = prev;
  }
});
