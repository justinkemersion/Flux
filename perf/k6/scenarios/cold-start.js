import { createOptions, requestGateway, stage } from "../lib/gateway.js";
import { fixedHost } from "../lib/hosts.js";

const hostPicker = fixedHost();

export const options = createOptions({
  startRate: 500,
  stages: [stage(10000, "60s"), stage(10000, "30s")],
  preAllocatedVUs: 800,
  maxVUs: 2800,
  thresholds: {
    http_req_duration: ["p(95)<400", "p(99)<1200"],
    status_504: ["rate<0.02"],
    status_other_5xx: ["rate<0.005"],
    expected_status: ["rate>0.99"],
  },
});

export default function () {
  requestGateway({
    scenario: "cold-start",
    hostPicker,
    expectedStatuses: [200, 429, 503, 504],
  });
}
