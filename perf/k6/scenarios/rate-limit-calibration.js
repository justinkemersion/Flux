import { createOptions, requestGateway, stage } from "../lib/gateway.js";
import { fixedHost } from "../lib/hosts.js";

const hostPicker = fixedHost();

export const options = createOptions({
  startRate: 10,
  stages: [stage(50, "20s"), stage(100, "40s"), stage(150, "20s")],
  preAllocatedVUs: 100,
  maxVUs: 500,
  thresholds: {
    http_req_duration: ["p(95)<250"],
    status_429: ["rate>0.01"],
    status_other_5xx: ["rate<0.005"],
    expected_status: ["rate>0.995"],
  },
});

export default function () {
  requestGateway({
    scenario: "rate-limit-calibration",
    hostPicker,
    expectedStatuses: [200, 429],
  });
}
