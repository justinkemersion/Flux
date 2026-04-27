import { createOptions, requestGateway, stage } from "../lib/gateway.js";
import { hotTenantHost } from "../lib/hosts.js";

const hostPicker = hotTenantHost();

export const options = createOptions({
  startRate: 200,
  stages: [stage(5000, "30s"), stage(5000, "60s")],
  preAllocatedVUs: 600,
  maxVUs: 2400,
  thresholds: {
    http_req_duration: ["p(95)<400", "p(99)<1200"],
    status_other_5xx: ["rate<0.01"],
    expected_status: ["rate>0.99"],
  },
});

export default function () {
  requestGateway({
    scenario: "hot-tenant",
    hostPicker,
    expectedStatuses: [200, 404, 429, 503, 504],
  });
}
