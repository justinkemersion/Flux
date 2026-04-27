import { createOptions, requestGateway, stage } from "../lib/gateway.js";
import { randomHost } from "../lib/hosts.js";

const hostPicker = randomHost();

export const options = createOptions({
  startRate: 200,
  stages: [stage(5000, "30s"), stage(5000, "60s")],
  preAllocatedVUs: 500,
  maxVUs: 2200,
  thresholds: {
    http_req_duration: ["p(95)<600", "p(99)<1600"],
    status_other_5xx: ["rate<0.01"],
    expected_status: ["rate>0.99"],
  },
});

export default function () {
  requestGateway({
    scenario: "random-host",
    hostPicker,
    expectedStatuses: [404, 429, 503, 504],
  });
}
