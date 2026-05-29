import test from "node:test";
import assert from "node:assert/strict";
import {
  V2_GATEWAY_AUTH_REQUIRED_ERROR,
  isTenantProbeSuccess,
} from "./tenant-api-probe.ts";

test("isTenantProbeSuccess accepts 2xx and 3xx for all modes", () => {
  assert.equal(isTenantProbeSuccess(200, "v2_shared"), true);
  assert.equal(isTenantProbeSuccess(301, "v1_dedicated"), true);
});

test("isTenantProbeSuccess treats v2_shared gateway 401 as reachable", () => {
  assert.equal(isTenantProbeSuccess(401, "v2_shared"), true);
});

test("isTenantProbeSuccess rejects v1_dedicated 401", () => {
  assert.equal(isTenantProbeSuccess(401, "v1_dedicated"), false);
});

test("isTenantProbeSuccess rejects 404 and 5xx", () => {
  assert.equal(isTenantProbeSuccess(404, "v2_shared"), false);
  assert.equal(isTenantProbeSuccess(502, "v2_shared"), false);
  assert.equal(isTenantProbeSuccess(503, "v2_shared"), false);
});

test("V2_GATEWAY_AUTH_REQUIRED_ERROR matches gateway contract", () => {
  assert.equal(V2_GATEWAY_AUTH_REQUIRED_ERROR, "authorization required");
});
