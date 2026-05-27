import test from "node:test";
import assert from "node:assert/strict";
import { resolveCliRoleForUser } from "./cli-admin";

test("resolveCliRoleForUser returns operator when no admin list configured", () => {
  const prev = process.env.FLUX_CLI_ADMIN_EMAILS;
  const prevIds = process.env.FLUX_CLI_ADMIN_USER_IDS;
  delete process.env.FLUX_CLI_ADMIN_EMAILS;
  delete process.env.FLUX_CLI_ADMIN_USER_IDS;
  try {
    assert.equal(
      resolveCliRoleForUser({
        userId: "u1",
        email: "justin@example.com",
      }),
      "operator",
    );
  } finally {
    if (prev === undefined) delete process.env.FLUX_CLI_ADMIN_EMAILS;
    else process.env.FLUX_CLI_ADMIN_EMAILS = prev;
    if (prevIds === undefined) delete process.env.FLUX_CLI_ADMIN_USER_IDS;
    else process.env.FLUX_CLI_ADMIN_USER_IDS = prevIds;
  }
});

test("resolveCliRoleForUser matches admin email case-insensitively", () => {
  const prev = process.env.FLUX_CLI_ADMIN_EMAILS;
  process.env.FLUX_CLI_ADMIN_EMAILS = "Admin@Example.com,other@x.com";
  try {
    assert.equal(
      resolveCliRoleForUser({
        userId: "u1",
        email: "admin@example.com",
      }),
      "admin",
    );
    assert.equal(
      resolveCliRoleForUser({
        userId: "u2",
        email: "other@x.com",
      }),
      "admin",
    );
    assert.equal(
      resolveCliRoleForUser({
        userId: "u3",
        email: "nobody@example.com",
      }),
      "operator",
    );
  } finally {
    if (prev === undefined) delete process.env.FLUX_CLI_ADMIN_EMAILS;
    else process.env.FLUX_CLI_ADMIN_EMAILS = prev;
  }
});
