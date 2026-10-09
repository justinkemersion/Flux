import test from "node:test";
import assert from "node:assert/strict";
import { fleetHttpProbeAction, resolveV2SharedFleetHealthStatus } from "./fleet-monitor.ts";

test("fleet probe skips archived projects and still probes dormant ones", () => {
  assert.equal(
    fleetHttpProbeAction({
      lifecycleState: "archived",
      mode: "v2_shared",
      stopped: false,
    }),
    "skip-archived",
  );
  assert.equal(
    fleetHttpProbeAction({
      lifecycleState: "archived",
      mode: "v1_dedicated",
      stopped: false,
    }),
    "skip-archived",
  );
  assert.equal(
    fleetHttpProbeAction({
      lifecycleState: "dormant",
      mode: "v2_shared",
      stopped: false,
    }),
    "probe",
  );
  assert.equal(
    fleetHttpProbeAction({
      lifecycleState: "active",
      mode: "v1_dedicated",
      stopped: true,
    }),
    "record-stopped",
  );
  assert.equal(
    fleetHttpProbeAction({
      lifecycleState: "active",
      mode: "v1_dedicated",
      stopped: false,
    }),
    "probe",
  );
});

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
