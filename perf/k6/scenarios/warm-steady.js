import { createOptions, requestGateway, stage } from "../lib/gateway.js";
import { fixedHost } from "../lib/hosts.js";

const hostPicker = fixedHost();

export const options = createOptions({
  startRate: 200,
  stages: [stage(5000, "30s"), stage(10000, "60s"), stage(10000, "30s")],
  preAllocatedVUs: 600,
  maxVUs: 2400,
  thresholds: {
    http_req_duration: ["p(95)<250", "p(99)<700"],
    status_503: ["rate<0.02"],
    status_504: ["rate<0.01"],
    expected_status: ["rate>0.995"],
  },
});

export default function () {
  requestGateway({
    scenario: "warm-steady",
    hostPicker,
    expectedStatuses: [200, 429, 503],
  });
}
