import { createOptions, requestGateway, stage } from "../lib/gateway.js";
import { fixedHost } from "../lib/hosts.js";

const hostPicker = fixedHost();

export const options = createOptions({
  startRate: 200,
  stages: [stage(5000, "30s"), stage(5000, "60s")],
  preAllocatedVUs: 500,
  maxVUs: 2200,
  thresholds: {
    http_req_duration: ["p(95)<350", "p(99)<900"],
    status_other_5xx: ["rate<0.005"],
    expected_status: ["rate>0.995"],
  },
});

export default function () {
  requestGateway({
    scenario: "redis-down",
    hostPicker,
    expectedStatuses: [200, 429, 503, 504],
  });
}
