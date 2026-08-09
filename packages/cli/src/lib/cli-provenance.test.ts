import test from "node:test";
import assert from "node:assert/strict";
import {
  allowsProductionMutation,
  classifyCliArtifact,
  formatProductionBlockMessage,
  sameGitSha,
  warnsOnReadOnly,
  type CliBuildProvenance,
} from "./cli-provenance.ts";

const SHA = "460a4aade32fd87b86870b59412f27880e10a685";
const OTHER_SHA = "be729630b1a04c1b8a1f52d0f0d3f8a3c1d9e7f2";

function bundle(
  overrides: Partial<CliBuildProvenance> = {},
): CliBuildProvenance {
  return {
    runtime: "bundle",
    version: "2.0.1",
    sourceSha: SHA,
    sourceDirtyAtBuild: false,
    buildTimestamp: "2026-08-09T10:00:00.000Z",
    buildRepoRoot: "/home/justin/Projects/flux",
    ...overrides,
  };
}

test("matching source and build is verified and may mutate production", () => {
  const verdict = classifyCliArtifact(bundle(), {
    headSha: SHA,
    dirty: false,
  });
  assert.equal(verdict.status, "verified");
  assert.equal(allowsProductionMutation(verdict.status), true);
  assert.equal(warnsOnReadOnly(verdict.status), false);
});

test("stale SHA fails closed for production mutation", () => {
  const verdict = classifyCliArtifact(bundle(), {
    headSha: OTHER_SHA,
    dirty: false,
  });
  assert.equal(verdict.status, "stale");
  assert.equal(allowsProductionMutation(verdict.status), false);
  assert.match(verdict.detail, /built from 460a4aade32f/u);
  assert.match(verdict.detail, /checkout is at be729630b1a0/u);
});

test("this is the Stage 10 scenario: bundle predates the pooled-push fix", () => {
  // dist built at an earlier commit while the fix landed later on the same day.
  const preFix = bundle({ sourceSha: OTHER_SHA });
  const verdict = classifyCliArtifact(preFix, { headSha: SHA, dirty: false });
  assert.equal(verdict.status, "stale");
  assert.equal(allowsProductionMutation(verdict.status), false);
});

test("unknown provenance fails closed for production mutation", () => {
  for (const provenance of [
    bundle({ sourceSha: null }),
    bundle({ sourceSha: "" }),
    bundle({ sourceDirtyAtBuild: true }),
  ]) {
    const verdict = classifyCliArtifact(provenance, {
      headSha: SHA,
      dirty: false,
    });
    assert.equal(verdict.status, "unknown");
    assert.equal(allowsProductionMutation(verdict.status), false);
  }
});

test("dirty source checkout cannot correspond to any build", () => {
  const verdict = classifyCliArtifact(bundle(), { headSha: SHA, dirty: true });
  assert.equal(verdict.status, "stale");
  assert.equal(allowsProductionMutation(verdict.status), false);
});

test("running from source is never stale", () => {
  const verdict = classifyCliArtifact(
    {
      runtime: "source",
      version: "2.0.1",
      sourceSha: null,
      sourceDirtyAtBuild: null,
      buildTimestamp: null,
      buildRepoRoot: null,
    },
    null,
  );
  assert.equal(verdict.status, "source");
  assert.equal(allowsProductionMutation(verdict.status), true);
});

test("released bundle without a checkout keeps established provenance usable", () => {
  const verdict = classifyCliArtifact(bundle(), null);
  assert.equal(verdict.status, "unverifiable");
  assert.equal(allowsProductionMutation(verdict.status), true);
  assert.equal(warnsOnReadOnly(verdict.status), false);
});

test("read-only commands stay usable but warn on stale and unknown", () => {
  assert.equal(warnsOnReadOnly("stale"), true);
  assert.equal(warnsOnReadOnly("unknown"), true);
  assert.equal(warnsOnReadOnly("verified"), false);
  assert.equal(warnsOnReadOnly("source"), false);
  assert.equal(warnsOnReadOnly("unverifiable"), false);
});

test("sameGitSha compares on the shorter prefix and rejects stubs", () => {
  assert.equal(sameGitSha(SHA, "460a4aa"), true);
  assert.equal(sameGitSha("460a4aa", SHA), true);
  assert.equal(sameGitSha(SHA, SHA.toUpperCase()), true);
  assert.equal(sameGitSha(SHA, OTHER_SHA), false);
  assert.equal(sameGitSha(SHA, "460a"), false, "too short to be meaningful");
  assert.equal(sameGitSha("", ""), false);
});

test("block message names the command, both SHAs, and the rebuild step", () => {
  const provenance = bundle();
  const verdict = classifyCliArtifact(provenance, {
    headSha: OTHER_SHA,
    dirty: false,
  });
  const msg = formatProductionBlockMessage("push", provenance, verdict);
  assert.match(msg, /flux push/u);
  assert.match(msg, /stale/u);
  assert.match(msg, /460a4aade32f/u);
  assert.match(msg, /pnpm --filter @flux\/cli build/u);
  assert.match(msg, /FLUX_ALLOW_STALE_CLI=1/u);
});
