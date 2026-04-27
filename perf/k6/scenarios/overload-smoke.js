/**
 * Short overload sample for Tier-3 scoring (paired with arch-truth-test).
 * Intentionally gentler than overload.js — tune via env if needed.
 */
import { createOptions, requestGateway, stage } from "../lib/gateway.js";
import { fixedHost } from "../lib/hosts.js";

const hostPicker = fixedHost();

export const options = createOptions({
  startRate: Number(__ENV.OVERLOAD_SMOKE_START || 80),
  stages: [
    stage(Number(__ENV.OVERLOAD_SMOKE_S1 || 400), __ENV.OVERLOAD_SMOKE_S1D || "20s"),
    stage(Number(__ENV.OVERLOAD_SMOKE_S2 || 800), __ENV.OVERLOAD_SMOKE_S2D || "25s"),
  ],
  preAllocatedVUs: Number(__ENV.OVERLOAD_SMOKE_PRE_VU || 150),
  maxVUs: Number(__ENV.OVERLOAD_SMOKE_MAX_VU || 400),
  thresholds: {
    http_req_duration: ["p(95)<8000"],
    status_other_5xx: ["rate<0.05"],
    expected_status: ["rate>0.90"],
  },
});

export default function () {
  requestGateway({
    scenario: "overload-smoke",
    hostPicker,
    expectedStatuses: [200, 429, 503, 504],
  });
}
