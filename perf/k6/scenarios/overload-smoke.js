/**
 * Short overload sample for Tier-3 scoring (paired with arch-truth-test).
 * Intentionally gentler than overload.js — tune via env if needed.
 *
 * When BASE_URL points at loopback, set HOST (or KNOWN_HOST) to your tenant hostname — same rule as arch-truth-test.
 */
import { createOptions, requestGateway, stage } from "../lib/gateway.js";
import { fixedHost } from "../lib/hosts.js";

function upstreamHostnameLooksLoopback(base) {
  try {
    const h = new URL(base).hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    return false;
  }
}

const _baseUrl = __ENV.BASE_URL || "http://localhost:4000";
const _explicitTenantHost = (__ENV.KNOWN_HOST || __ENV.HOST || "").trim();
if (upstreamHostnameLooksLoopback(_baseUrl) && !_explicitTenantHost) {
  throw new Error(
    "[overload-smoke] BASE_URL is loopback but HOST/KNOWN_HOST is unset. " +
      "Export HOST=api.<slug>.<hash>.<domain> (tenant Host header — same value as KNOWN_HOST for arch-truth).",
  );
}

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
