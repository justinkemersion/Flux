import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCliArtifact,
  type CliBuildProvenance,
  type SourceCheckoutState,
} from "./cli-provenance.ts";
import {
  resolveCliBuildProvenance,
  type CliProvenanceReport,
} from "./cli-provenance-runtime.ts";
import {
  evaluateProductionMutationGate,
  isStaleCliOverrideEnabled,
  PRODUCTION_MUTATION_COMMANDS,
} from "./production-artifact-guard.ts";

const SHA = "460a4aade32fd87b86870b59412f27880e10a685";
const OTHER_SHA = "be729630b1a04c1b8a1f52d0f0d3f8a3c1d9e7f2";

function report(
  provenance: CliBuildProvenance,
  checkout: SourceCheckoutState | null,
): CliProvenanceReport {
  return {
    provenance,
    checkout,
    verdict: classifyCliArtifact(provenance, checkout),
  };
}

const freshBundle: CliBuildProvenance = {
  runtime: "bundle",
  version: "2.0.1",
  sourceSha: SHA,
  sourceDirtyAtBuild: false,
  buildTimestamp: "2026-08-09T10:00:00.000Z",
  buildRepoRoot: "/home/justin/Projects/flux",
};

test("matching build proceeds without override", () => {
  const gate = evaluateProductionMutationGate(
    "push",
    report(freshBundle, { headSha: SHA, dirty: false }),
    false,
  );
  assert.equal(gate.allowed, true);
  assert.equal(gate.overridden, false);
  assert.equal(gate.error, undefined);
});

test("stale build is blocked with an actionable error", () => {
  const gate = evaluateProductionMutationGate(
    "push",
    report(freshBundle, { headSha: OTHER_SHA, dirty: false }),
    false,
  );
  assert.equal(gate.allowed, false);
  assert.equal(gate.error?.name, "StaleCliArtifactError");
  assert.equal(gate.error?.verdict.status, "stale");
  assert.match(String(gate.error?.message), /Refusing to run `flux push`/u);
});

test("unknown provenance is blocked for every protected command", () => {
  const noSha = { ...freshBundle, sourceSha: null };
  for (const command of PRODUCTION_MUTATION_COMMANDS) {
    const gate = evaluateProductionMutationGate(
      command,
      report(noSha, { headSha: SHA, dirty: false }),
      false,
    );
    assert.equal(gate.allowed, false, `${command} must fail closed`);
    assert.equal(gate.error?.verdict.status, "unknown");
    assert.match(String(gate.error?.message), new RegExp(`flux ${command}`, "u"));
  }
});

test("override unblocks but is reported as overridden", () => {
  const gate = evaluateProductionMutationGate(
    "push",
    report(freshBundle, { headSha: OTHER_SHA, dirty: false }),
    true,
  );
  assert.equal(gate.allowed, true);
  assert.equal(gate.overridden, true);
});

test("override is not consulted when provenance is already good", () => {
  const gate = evaluateProductionMutationGate(
    "push",
    report(freshBundle, { headSha: SHA, dirty: false }),
    true,
  );
  assert.equal(gate.overridden, false);
});

test("override env parsing treats unset, empty and 0 as disabled", () => {
  assert.equal(isStaleCliOverrideEnabled({}), false);
  assert.equal(isStaleCliOverrideEnabled({ FLUX_ALLOW_STALE_CLI: "" }), false);
  assert.equal(isStaleCliOverrideEnabled({ FLUX_ALLOW_STALE_CLI: "0" }), false);
  assert.equal(isStaleCliOverrideEnabled({ FLUX_ALLOW_STALE_CLI: "1" }), true);
  assert.equal(
    isStaleCliOverrideEnabled({ FLUX_ALLOW_STALE_CLI: "yes" }),
    true,
  );
});

test("the protected set covers the SQL-executing and destructive commands", () => {
  assert.deepEqual(
    [...PRODUCTION_MUTATION_COMMANDS].sort(),
    ["db restore", "db-reset", "migrate", "nuke", "push", "reap"],
  );
});

test("provenance is absent when running from source, so no env can forge it", () => {
  // Guards against reintroducing an env-var injection point: under tsx the bundle
  // define never ran, so runtime must be "source" regardless of environment.
  process.env.__FLUX_BUILD_PROVENANCE__ = JSON.stringify({ sourceSha: SHA });
  try {
    assert.equal(resolveCliBuildProvenance().runtime, "source");
  } finally {
    delete process.env.__FLUX_BUILD_PROVENANCE__;
  }
});
