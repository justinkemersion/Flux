import { createOptions, requestGateway, stage } from "../lib/gateway.js";
import { fixedHost } from "../lib/hosts.js";

const hostPicker = fixedHost();

export const options = createOptions({
  startRate: 500,
  stages: [stage(12000, "30s"), stage(20000, "60s"), stage(20000, "30s")],
  preAllocatedVUs: 1200,
  maxVUs: 4000,
  thresholds: {
    http_req_duration: ["p(95)<800", "p(99)<2200"],
    status_503: ["rate>0.05"],
    status_other_5xx: ["rate<0.01"],
    expected_status: ["rate>0.99"],
  },
});

export default function () {
  requestGateway({
    scenario: "overload",
    hostPicker,
    expectedStatuses: [200, 429, 503, 504],
  });
}
