import assert from "node:assert/strict";
import test from "node:test";
import { classifyGauntletFailure } from "./failure-class";
import type { StageRecord } from "./types";

test("classifyGauntletFailure returns undefined on pass", () => {
  assert.equal(
    classifyGauntletFailure({
      mode: "v1_dedicated",
      status: "pass",
      stages: [{ name: "preflight", status: "passed", startedAt: "" }],
    }),
    undefined,
  );
});

test("v2 wait_for_health 401 is auth_handshake_mismatch", () => {
  const stages: StageRecord[] = [
    { name: "create_project", status: "passed", startedAt: "" },
    {
      name: "wait_for_health",
      status: "failed",
      startedAt: "",
      error: {
        message:
          "PostgREST did not become healthy: PostgREST OpenAPI probe failed: HTTP 401 {\"error\":\"invalid or expired token\"}",
      },
    },
  ];
  const c = classifyGauntletFailure({
    mode: "v2_shared",
    status: "fail",
    stages,
  });
  assert.equal(c?.failureClass, "auth_handshake_mismatch");
  assert.match(c?.failureClassDetail ?? "", /stable sub claim/u);
  assert.doesNotMatch(c?.failureClassDetail ?? "", /does not yet implement/u);
});

test("v1 failure is platform_failure", () => {
  const c = classifyGauntletFailure({
    mode: "v1_dedicated",
    status: "fail",
    stages: [
      {
        name: "backup_verify",
        status: "failed",
        startedAt: "",
        error: { message: "restore failed" },
      },
    ],
  });
  assert.equal(c?.failureClass, "platform_failure");
});

test("v2 push unavailable is unsupported_mode_path", () => {
  const c = classifyGauntletFailure({
    mode: "v2_shared",
    status: "fail",
    stages: [
      {
        name: "push_schema",
        status: "failed",
        startedAt: "",
        error: { message: "v2_shared push unavailable: dashboard base not set" },
      },
    ],
  });
  assert.equal(c?.failureClass, "unsupported_mode_path");
});
