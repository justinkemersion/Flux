import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyControlPlaneProvenance,
  FORBIDDEN_PROVENANCE_FIELDS,
  parseControlPlaneProvenance,
} from "@flux/core/control-plane-provenance";
import {
  FLUX_GATEWAY_CONTRACT_VERSION,
  FLUX_POOLED_PUSH_ADAPTER_CONTRACT,
} from "@flux/core/contract-versions";
import { getControlPlaneProvenance } from "./build-provenance";

const SHA = "16a8224f07b91854c4d8b9b3b30801c7e97af7b1";

function withBuildEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => T,
): T {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("contract versions always come from compiled source, never from env", () => {
  const provenance = withBuildEnv(
    {
      FLUX_BUILD_SOURCE_SHA: SHA,
      FLUX_BUILD_DIRTY: "0",
      FLUX_BUILD_TIMESTAMP: "2026-08-09T11:00:00Z",
    },
    getControlPlaneProvenance,
  );
  assert.equal(
    provenance.gatewayContractVersion,
    FLUX_GATEWAY_CONTRACT_VERSION,
  );
  assert.equal(
    provenance.pooledPushAdapterContract,
    FLUX_POOLED_PUSH_ADAPTER_CONTRACT,
  );
  assert.equal(classifyControlPlaneProvenance(provenance).status, "established");
});

test("absent build provenance classifies as unknown rather than guessing", () => {
  const provenance = withBuildEnv(
    {
      FLUX_BUILD_SOURCE_SHA: undefined,
      FLUX_BUILD_DIRTY: undefined,
      FLUX_BUILD_TIMESTAMP: undefined,
    },
    getControlPlaneProvenance,
  );
  assert.equal(provenance.sourceSha, null);
  assert.equal(classifyControlPlaneProvenance(provenance).status, "unknown");
});

test("empty build args are treated as absent, not as a valid commit", () => {
  const provenance = withBuildEnv(
    { FLUX_BUILD_SOURCE_SHA: "   ", FLUX_BUILD_DIRTY: "" },
    getControlPlaneProvenance,
  );
  assert.equal(provenance.sourceSha, null);
  assert.equal(provenance.dirtyAtBuild, null);
});

test("dirty build flag is reported so readiness can fail closed", () => {
  for (const raw of ["1", "true"]) {
    const provenance = withBuildEnv(
      { FLUX_BUILD_SOURCE_SHA: SHA, FLUX_BUILD_DIRTY: raw },
      getControlPlaneProvenance,
    );
    assert.equal(provenance.dirtyAtBuild, true);
    assert.equal(classifyControlPlaneProvenance(provenance).status, "dirty");
  }
});

test("GET /api/health serves provenance and stays available", async () => {
  const { GET } = await import("../../app/api/health/route");
  const response = withBuildEnv(
    {
      FLUX_BUILD_SOURCE_SHA: SHA,
      FLUX_BUILD_DIRTY: "0",
      FLUX_BUILD_TIMESTAMP: "2026-08-09T11:00:00Z",
    },
    () => GET(),
  );
  assert.equal(response.status, 200, "liveness must not depend on provenance");
  assert.equal(response.headers.get("Cache-Control"), "no-store");

  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.provenanceStatus, "established");
  const parsed = parseControlPlaneProvenance(body);
  assert.equal(parsed?.sourceSha, SHA);
  assert.equal(parsed?.pooledPushAdapterContract, "2.0.0");
});

test("health stays 200 even when provenance is unknown", async () => {
  const { GET } = await import("../../app/api/health/route");
  const response = withBuildEnv({ FLUX_BUILD_SOURCE_SHA: undefined }, () =>
    GET(),
  );
  assert.equal(
    response.status,
    200,
    "an unidentifiable but working container must not be restarted by orchestrators",
  );
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.provenanceStatus, "unknown");
});

test("provenance response exposes no secrets, paths or tenant identifiers", async () => {
  const { GET } = await import("../../app/api/health/route");
  const response = withBuildEnv(
    { FLUX_BUILD_SOURCE_SHA: SHA, FLUX_BUILD_DIRTY: "0" },
    () => GET(),
  );
  const body = (await response.json()) as Record<string, unknown>;

  const allowedTop = new Set([
    "ok",
    "status",
    "provenanceStatus",
    "provenanceDetail",
    "provenance",
  ]);
  for (const key of Object.keys(body)) {
    assert.ok(allowedTop.has(key), `unexpected top-level field: ${key}`);
  }

  const allowedProvenance = new Set([
    "version",
    "sourceSha",
    "dirtyAtBuild",
    "buildTimestamp",
    "gatewayContractVersion",
    "pooledPushAdapterContract",
  ]);
  for (const key of Object.keys(body.provenance as Record<string, unknown>)) {
    assert.ok(allowedProvenance.has(key), `unexpected provenance field: ${key}`);
  }

  const serialized = JSON.stringify(body).toLowerCase();
  for (const forbidden of FORBIDDEN_PROVENANCE_FIELDS) {
    assert.ok(
      !serialized.includes(forbidden.toLowerCase()),
      `response must not mention ${forbidden}`,
    );
  }
  // Guard against leaking the build machine's checkout location.
  assert.ok(!serialized.includes("/home/"));
  assert.ok(!serialized.includes("/app"));
});
