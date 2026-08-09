import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyControlPlaneProvenance,
  evaluateMigrationReadiness,
  FORBIDDEN_PROVENANCE_FIELDS,
  parseControlPlaneProvenance,
  sameSha,
  type ControlPlaneProvenance,
  type ExpectedControlPlaneContracts,
} from "./control-plane-provenance.ts";
import {
  FLUX_GATEWAY_CONTRACT_VERSION,
  FLUX_POOLED_PUSH_ADAPTER_CONTRACT,
} from "./contract-versions.ts";

const DEPLOYED_SHA = "16a8224f07b91854c4d8b9b3b30801c7e97af7b1";
const LOCAL_SHA = "3fc6ccef47a739e146425f754fd77a3cdc9d117c";

function deployed(
  overrides: Partial<ControlPlaneProvenance> = {},
): ControlPlaneProvenance {
  return {
    version: "0.1.0",
    sourceSha: DEPLOYED_SHA,
    dirtyAtBuild: false,
    buildTimestamp: "2026-08-09T11:00:00Z",
    gatewayContractVersion: FLUX_GATEWAY_CONTRACT_VERSION,
    pooledPushAdapterContract: FLUX_POOLED_PUSH_ADAPTER_CONTRACT,
    ...overrides,
  };
}

function expected(
  overrides: Partial<ExpectedControlPlaneContracts> = {},
): ExpectedControlPlaneContracts {
  return {
    pooledPushAdapterContract: FLUX_POOLED_PUSH_ADAPTER_CONTRACT,
    gatewayContractVersion: FLUX_GATEWAY_CONTRACT_VERSION,
    localSourceSha: DEPLOYED_SHA,
    ...overrides,
  };
}

test("matching contracts are ready for pooled production migration", () => {
  const r = evaluateMigrationReadiness(deployed(), expected());
  assert.equal(r.ready, true);
  assert.equal(r.verdict.status, "established");
  assert.deepEqual(r.reasons, []);
  assert.equal(r.shaMatchesLocal, true);
});

test("unreachable control plane fails closed", () => {
  const r = evaluateMigrationReadiness(null, expected());
  assert.equal(r.ready, false);
  assert.equal(r.verdict.status, "unreachable");
  assert.equal(r.reasons[0]?.code, "control_plane_unreachable");
});

test("unknown provenance fails closed", () => {
  const r = evaluateMigrationReadiness(
    deployed({ sourceSha: null }),
    expected(),
  );
  assert.equal(r.ready, false);
  assert.equal(r.verdict.status, "unknown");
  assert.equal(r.reasons[0]?.code, "control_plane_unknown");
});

test("control plane advertising no adapter contract fails closed", () => {
  const r = evaluateMigrationReadiness(
    deployed({ pooledPushAdapterContract: null }),
    expected(),
  );
  assert.equal(r.ready, false);
  assert.equal(r.verdict.status, "unknown");
});

test("dirty control-plane build fails closed", () => {
  const r = evaluateMigrationReadiness(
    deployed({ dirtyAtBuild: true }),
    expected(),
  );
  assert.equal(r.ready, false);
  assert.equal(r.verdict.status, "dirty");
  assert.equal(r.reasons[0]?.code, "control_plane_dirty");
});

test("stale adapter contract is blocked and named", () => {
  const r = evaluateMigrationReadiness(
    deployed({ pooledPushAdapterContract: "1.0.0" }),
    expected(),
  );
  assert.equal(r.ready, false);
  assert.equal(r.reasons[0]?.code, "adapter_contract_mismatch");
  assert.match(String(r.reasons[0]?.detail), /is 1\.0\.0/u);
  assert.match(String(r.reasons[0]?.detail), /expects 2\.0\.0/u);
});

test("gateway contract mismatch is visible", () => {
  const r = evaluateMigrationReadiness(
    deployed({ gatewayContractVersion: "0.9.0" }),
    expected(),
  );
  assert.equal(r.ready, false);
  assert.equal(r.reasons[0]?.code, "gateway_contract_mismatch");
  assert.match(String(r.reasons[0]?.detail), /0\.9\.0/u);
});

test("a different commit with agreeing contracts is ready by default", () => {
  // Unrelated Flux commits must not block application migrations; the adapter contract is
  // digest-pinned to the adapter source, so agreement is the meaningful check.
  const r = evaluateMigrationReadiness(
    deployed(),
    expected({ localSourceSha: LOCAL_SHA }),
  );
  assert.equal(r.ready, true);
  assert.equal(r.shaMatchesLocal, false);
});

test("requireShaMatch enforces exact equality for operators who want it", () => {
  const r = evaluateMigrationReadiness(
    deployed(),
    expected({ localSourceSha: LOCAL_SHA, requireShaMatch: true }),
  );
  assert.equal(r.ready, false);
  assert.equal(r.reasons[0]?.code, "sha_mismatch");
  assert.match(String(r.reasons[0]?.detail), /16a8224f07b9/u);
  assert.match(String(r.reasons[0]?.detail), /3fc6ccef47a7/u);
});

test("requireShaMatch passes when the deployed commit is the local commit", () => {
  const r = evaluateMigrationReadiness(
    deployed(),
    expected({ requireShaMatch: true }),
  );
  assert.equal(r.ready, true);
});

test("parses a health response and tolerates the nested provenance shape", () => {
  const nested = parseControlPlaneProvenance({
    ok: true,
    provenanceStatus: "established",
    provenance: deployed(),
  });
  assert.equal(nested?.sourceSha, DEPLOYED_SHA);
  assert.equal(nested?.pooledPushAdapterContract, "2.0.0");

  const flat = parseControlPlaneProvenance(deployed());
  assert.equal(flat?.sourceSha, DEPLOYED_SHA);
});

test("rejects payloads that are not provenance documents", () => {
  assert.equal(parseControlPlaneProvenance(null), null);
  assert.equal(parseControlPlaneProvenance("ok"), null);
  assert.equal(parseControlPlaneProvenance({ status: "ok" }), null);
  assert.equal(parseControlPlaneProvenance({ ok: true }), null);
});

test("a malformed sha is treated as absent rather than trusted", () => {
  const p = parseControlPlaneProvenance(
    deployed({ sourceSha: "not-a-sha" } as Partial<ControlPlaneProvenance>),
  );
  assert.equal(p?.sourceSha, null);
  assert.equal(classifyControlPlaneProvenance(p).status, "unknown");
});

test("sameSha compares on the shorter prefix and rejects stubs", () => {
  assert.equal(sameSha(DEPLOYED_SHA, "16a8224"), true);
  assert.equal(sameSha(DEPLOYED_SHA, DEPLOYED_SHA.toUpperCase()), true);
  assert.equal(sameSha(DEPLOYED_SHA, LOCAL_SHA), false);
  assert.equal(sameSha(DEPLOYED_SHA, "16a"), false);
  assert.equal(sameSha(null, DEPLOYED_SHA), false);
});

test("the provenance contract declares no sensitive field names", () => {
  const fields = Object.keys(deployed());
  for (const forbidden of FORBIDDEN_PROVENANCE_FIELDS) {
    assert.ok(
      !fields.includes(forbidden),
      `provenance must not carry ${forbidden}`,
    );
  }
});
