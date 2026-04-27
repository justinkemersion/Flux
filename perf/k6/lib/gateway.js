import http from "k6/http";
import { check } from "k6";
import { Counter, Rate } from "k6/metrics";

const status2xx = new Rate("status_2xx");
const status404 = new Rate("status_404");
const status429 = new Rate("status_429");
const status503 = new Rate("status_503");
const status504 = new Rate("status_504");
const statusOther5xx = new Rate("status_other_5xx");
const expectedStatus = new Rate("expected_status");
const unexpectedStatusCount = new Counter("unexpected_status_count");

export function stage(target, duration) {
  return { target, duration };
}

export function createOptions({
  startRate = 100,
  stages = [stage(5000, "30s"), stage(10000, "60s")],
  preAllocatedVUs = 500,
  maxVUs = 2000,
  thresholds = {},
}) {
  return {
    scenarios: {
      ramp: {
        executor: "ramping-arrival-rate",
        startRate,
        timeUnit: "1s",
        stages,
        preAllocatedVUs,
        maxVUs,
      },
    },
    thresholds: {
      http_req_failed: ["rate<0.02"],
      http_req_duration: ["p(95)<300", "p(99)<800"],
      status_other_5xx: ["rate<0.01"],
      ...thresholds,
    },
  };
}

export function requestGateway({
  scenario,
  baseUrl = __ENV.BASE_URL || "http://localhost:4000",
  timeout = __ENV.TIMEOUT || "10s",
  hostPicker,
  expectedStatuses = [200, 404, 429, 503, 504],
}) {
  const host = hostPicker();
  const reqHeaders = { Host: host };
  const loadTestHeader = (__ENV.LOAD_TEST_HEADER || "").toLowerCase();
  const loadTestKey = __ENV.LOAD_TEST_KEY || "";
  if (loadTestHeader === "true") {
    reqHeaders["x-load-test"] = "true";
    if (loadTestKey) reqHeaders["x-load-test-key"] = loadTestKey;
  }

  const res = http.get(`${baseUrl}/`, {
    headers: reqHeaders,
    timeout,
    tags: { scenario, host_class: classifyHost(host) },
  });

  status2xx.add(res.status >= 200 && res.status < 300);
  status404.add(res.status === 404);
  status429.add(res.status === 429);
  status503.add(res.status === 503);
  status504.add(res.status === 504);
  statusOther5xx.add(res.status >= 500 && ![503, 504].includes(res.status));

  const isExpected = expectedStatuses.includes(res.status);
  expectedStatus.add(isExpected);
  if (!isExpected) unexpectedStatusCount.add(1);

  check(res, {
    "status is expected": () => isExpected,
  });
}

function classifyHost(host) {
  if (host.startsWith("rand-")) return "random";
  if (host.includes("hot")) return "hot";
  return "normal";
}
