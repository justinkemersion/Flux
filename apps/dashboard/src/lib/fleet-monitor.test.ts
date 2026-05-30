import test from "node:test";
import assert from "node:assert/strict";
import { resolveV2SharedFleetHealthStatus } from "./fleet-monitor.ts";

test("resolveV2SharedFleetHealthStatus returns incomplete without jwt_secret", () => {
  assert.equal(
    resolveV2SharedFleetHealthStatus({ jwtSecret: null }),
    "incomplete",
  );
  assert.equal(
    resolveV2SharedFleetHealthStatus({ jwtSecret: "   " }),
    "incomplete",
  );
});

test("resolveV2SharedFleetHealthStatus returns null when probe should run", () => {
  assert.equal(
    resolveV2SharedFleetHealthStatus({ jwtSecret: "project-secret-32-chars-long!!" }),
    null,
  );
});

test("resolveV2SharedFleetHealthStatus maps probe result when secret present", () => {
  const secret = "project-secret-32-chars-long!!";
  assert.equal(
    resolveV2SharedFleetHealthStatus({ jwtSecret: secret, probeOk: true }),
    "running",
  );
  assert.equal(
    resolveV2SharedFleetHealthStatus({ jwtSecret: secret, probeOk: false }),
    "error",
  );
});
