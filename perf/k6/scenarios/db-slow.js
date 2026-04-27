import { createOptions, requestGateway, stage } from "../lib/gateway.js";
import { fixedHost } from "../lib/hosts.js";

const hostPicker = fixedHost();

export const options = createOptions({
  startRate: 200,
  stages: [stage(5000, "30s"), stage(5000, "60s")],
  preAllocatedVUs: 600,
  maxVUs: 2600,
  thresholds: {
    http_req_duration: ["p(95)<700", "p(99)<2000"],
    status_504: ["rate<0.05"],
    status_other_5xx: ["rate<0.01"],
    expected_status: ["rate>0.98"],
  },
});

export default function () {
  requestGateway({
    scenario: "db-slow",
    hostPicker,
    expectedStatuses: [200, 429, 503, 504],
  });
}
