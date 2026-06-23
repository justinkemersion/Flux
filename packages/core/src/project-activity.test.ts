import test from "node:test";
import assert from "node:assert/strict";
import {
  activityDayLabel,
  migrationAppliedSummary,
  sanitizeActivityMetadata,
} from "./project-activity.ts";

test("sanitizeActivityMetadata drops secret-like keys", () => {
  const out = sanitizeActivityMetadata({
    filename: "001.sql",
    password: "nope",
    jwtSecret: "nope",
    access: "readonly",
  });
  assert.equal(out.filename, "001.sql");
  assert.equal(out.access, "readonly");
  assert.equal("password" in out, false);
  assert.equal("jwtSecret" in out, false);
});

test("migrationAppliedSummary uses filename only", () => {
  assert.equal(
    migrationAppliedSummary("0017_create_issues.sql"),
    "Migration 0017_create_issues.sql applied",
  );
});

test("activityDayLabel returns Today for same UTC day", () => {
  const now = new Date("2026-06-22T18:00:00.000Z");
  assert.equal(
    activityDayLabel("2026-06-22T10:00:00.000Z", now),
    "Today",
  );
});
