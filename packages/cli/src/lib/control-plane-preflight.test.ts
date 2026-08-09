import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMigrationReadiness,
  parseControlPlaneProvenance,
  type ControlPlaneProvenance,
} from "@flux/core/control-plane-provenance";
import {
  FLUX_GATEWAY_CONTRACT_VERSION,
  FLUX_POOLED_PUSH_ADAPTER_CONTRACT,
} from "@flux/core/contract-versions";
import { classifyCliArtifact } from "./cli-provenance.ts";
import type { CliProvenanceReport } from "./cli-provenance-runtime.ts";
import {
  controlPlaneHealthUrl,
  formatControlPlaneReport,
  formatPooledBlockMessage,
  isControlPlaneOverrideEnabled,
  resolveExpectedContracts,
  type ControlPlanePreflight,
} from "./control-plane-preflight.ts";

const DEPLOYED_SHA = "16a8224f07b91854c4d8b9b3b30801c7e97af7b1";
const LOCAL_SHA = "3fc6ccef47a739e146425f754fd77a3cdc9d117c";

function cliReport(sha: string | null = DEPLOYED_SHA): CliProvenanceReport {
  const provenance = {
    runtime: "bundle" as const,
    version: "2.0.1",
    sourceSha: sha,
    sourceDirtyAtBuild: false,
    buildTimestamp: "2026-08-09T10:40:35Z",
    buildRepoRoot: "/home/justin/Projects/flux",
  };
  const checkout = sha == null ? null : { headSha: sha, dirty: false };
  return {
    provenance,
    checkout,
    verdict: classifyCliArtifact(provenance, checkout),
  };
}

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

function preflight(
  provenance: ControlPlaneProvenance | null,
  cli: CliProvenanceReport = cliReport(),
  requireShaMatch = false,
): ControlPlanePreflight {
  const expected = resolveExpectedContracts(cli, requireShaMatch);
  return {
    baseUrl: "https://flux.vsl-base.com",
    provenance,
    expected,
    readiness: evaluateMigrationReadiness(provenance, expected),
    cli,
  };
}

test("health url is derived from the dashboard origin", () => {
  assert.equal(
    controlPlaneHealthUrl("https://flux.vsl-base.com"),
    "https://flux.vsl-base.com/api/health",
  );
  assert.equal(
    controlPlaneHealthUrl("https://flux.vsl-base.com/"),
    "https://flux.vsl-base.com/api/health",
  );
});

test("expected contracts come from compiled core, and local sha from the checkout", () => {
  const expected = resolveExpectedContracts(cliReport(LOCAL_SHA), false);
  assert.equal(
    expected.pooledPushAdapterContract,
    FLUX_POOLED_PUSH_ADAPTER_CONTRACT,
  );
  assert.equal(expected.gatewayContractVersion, FLUX_GATEWAY_CONTRACT_VERSION);
  assert.equal(expected.localSourceSha, LOCAL_SHA);
  assert.equal(expected.requireShaMatch, undefined);
});

test("matching control plane reports READY", () => {
  const report = formatControlPlaneReport(preflight(deployed()));
  assert.match(report, /READY — pooled production migrations may proceed/u);
  assert.match(report, /matches local checkout\s+yes/u);
});

test("stale adapter contract reports NOT READY with the reason", () => {
  const p = preflight(deployed({ pooledPushAdapterContract: "1.0.0" }));
  assert.equal(p.readiness.ready, false);
  const report = formatControlPlaneReport(p);
  assert.match(report, /NOT READY/u);
  assert.match(report, /adapter_contract_mismatch/u);
});

test("a control plane predating the endpoint reports NOT READY, not READY", () => {
  const p = preflight(null);
  assert.equal(p.readiness.ready, false);
  const report = formatControlPlaneReport(p);
  assert.match(report, /NOT READY/u);
  assert.match(report, /control_plane_unreachable/u);
});

test("a stale CLI artifact alone makes the preflight NOT READY", () => {
  // Both controls must hold: #9 covers the CLI, this covers the control plane.
  const staleCli: CliProvenanceReport = (() => {
    const provenance = {
      runtime: "bundle" as const,
      version: "2.0.1",
      sourceSha: LOCAL_SHA,
      sourceDirtyAtBuild: false,
      buildTimestamp: "2026-08-09T10:40:35Z",
      buildRepoRoot: "/home/justin/Projects/flux",
    };
    const checkout = { headSha: DEPLOYED_SHA, dirty: false };
    return {
      provenance,
      checkout,
      verdict: classifyCliArtifact(provenance, checkout),
    };
  })();
  assert.equal(staleCli.verdict.status, "stale");
  const report = formatControlPlaneReport(preflight(deployed(), staleCli));
  assert.match(report, /NOT READY/u);
  assert.match(report, /cli_artifact/u);
});

test("gateway contract mismatch is visible in the operator report", () => {
  const report = formatControlPlaneReport(
    preflight(deployed({ gatewayContractVersion: "0.9.0" })),
  );
  assert.match(report, /gateway_contract_mismatch/u);
  assert.match(report, /0\.9\.0/u);
});

test("block message explains the boundary and names the remedy", () => {
  const msg = formatPooledBlockMessage(
    preflight(deployed({ pooledPushAdapterContract: "1.0.0" })),
  );
  assert.match(msg, /Refusing to apply a pooled \(v2_shared\) migration/u);
  assert.match(msg, /adapter runs in the control plane, not in this CLI/u);
  assert.match(msg, /bin\/deploy-web\.sh/u);
  assert.match(msg, /flux control-plane verify/u);
  assert.match(msg, /FLUX_ALLOW_UNVERIFIED_CONTROL_PLANE=1/u);
});

test("report never prints the control plane's build machine paths", () => {
  const report = formatControlPlaneReport(preflight(deployed()));
  assert.ok(!report.includes("/srv/"));
  assert.ok(!/deployed control plane[\s\S]*\/home\//iu.test(report));
});

test("override env parsing treats unset, empty and 0 as disabled", () => {
  assert.equal(isControlPlaneOverrideEnabled({}), false);
  assert.equal(
    isControlPlaneOverrideEnabled({ FLUX_ALLOW_UNVERIFIED_CONTROL_PLANE: "" }),
    false,
  );
  assert.equal(
    isControlPlaneOverrideEnabled({ FLUX_ALLOW_UNVERIFIED_CONTROL_PLANE: "0" }),
    false,
  );
  assert.equal(
    isControlPlaneOverrideEnabled({ FLUX_ALLOW_UNVERIFIED_CONTROL_PLANE: "1" }),
    true,
  );
});

test("a 404 body cannot be mistaken for provenance", () => {
  assert.equal(parseControlPlaneProvenance({ error: "Not Found" }), null);
  assert.equal(
    evaluateMigrationReadiness(
      parseControlPlaneProvenance({ error: "Not Found" }),
      resolveExpectedContracts(cliReport(), false),
    ).ready,
    false,
  );
});
