import test from "node:test";
import assert from "node:assert/strict";
import {
  DEDICATED_POSTGREST_PROBE_PATH,
  V2_GATEWAY_AUTH_REQUIRED_ERROR,
  buildTenantProbePlan,
  isArchivedProjectLifecycle,
  isTenantProbeSuccess,
  mintFleetProbeProjectJwt,
  probeTenantApiUrl,
  probeV2SharedCatalogProject,
} from "./tenant-api-probe.ts";

test("isTenantProbeSuccess accepts 2xx and 3xx for all modes", () => {
  assert.equal(isTenantProbeSuccess(200, "v2_shared"), true);
  assert.equal(isTenantProbeSuccess(301, "v1_dedicated"), true);
});

test("isTenantProbeSuccess treats v2_shared gateway 401 as reachable", () => {
  assert.equal(isTenantProbeSuccess(401, "v2_shared"), true);
});

test("isTenantProbeSuccess rejects v1_dedicated 401", () => {
  assert.equal(isTenantProbeSuccess(401, "v1_dedicated"), false);
});

test("isTenantProbeSuccess rejects 404 and 5xx", () => {
  assert.equal(isTenantProbeSuccess(404, "v2_shared"), false);
  assert.equal(isTenantProbeSuccess(502, "v2_shared"), false);
  assert.equal(isTenantProbeSuccess(503, "v2_shared"), false);
});

test("isTenantProbeSuccess rejects v2 401 when authenticated probe required", () => {
  assert.equal(
    isTenantProbeSuccess(401, "v2_shared", { requireAuthenticatedSuccess: true }),
    false,
  );
  assert.equal(
    isTenantProbeSuccess(200, "v2_shared", { requireAuthenticatedSuccess: true }),
    true,
  );
});

test("probeV2SharedCatalogProject fails closed without jwt_secret", async () => {
  const prev = process.env.FLUX_TENANT_PROBE_SHALLOW;
  delete process.env.FLUX_TENANT_PROBE_SHALLOW;
  try {
    const ok = await probeV2SharedCatalogProject({
      slug: "demo",
      hash: "abc1234",
      isProduction: false,
      jwtSecret: null,
    });
    assert.equal(ok, false);
  } finally {
    if (prev === undefined) delete process.env.FLUX_TENANT_PROBE_SHALLOW;
    else process.env.FLUX_TENANT_PROBE_SHALLOW = prev;
  }
});

test("fleet pre-check classifies missing jwt_secret as incomplete before HTTP probe", async () => {
  const { resolveV2SharedFleetHealthStatus } = await import("./fleet-monitor.ts");
  assert.equal(resolveV2SharedFleetHealthStatus({ jwtSecret: null }), "incomplete");
  assert.equal(
    resolveV2SharedFleetHealthStatus({
      jwtSecret: "secret",
      probeOk: false,
    }),
    "error",
  );
});

test("mintFleetProbeProjectJwt returns a non-empty JWT", async () => {
  const token = await mintFleetProbeProjectJwt(
    "project-secret-for-tests-32-characters",
  );
  assert.match(token, /^[\w-]+\.[\w-]+\.[\w-]+$/);
});

test("archived projects are not probed", async () => {
  assert.equal(isArchivedProjectLifecycle("archived"), true);
  assert.equal(isArchivedProjectLifecycle("dormant"), false);
  let calls = 0;
  const ok = await probeTenantApiUrl("yeastcoast", "3db3f78", true, "v2_shared", {
    lifecycleState: "archived",
    transport: async () => {
      calls += 1;
      return 503;
    },
  });
  assert.equal(ok, false);
  assert.equal(calls, 0);
  const v2 = await probeV2SharedCatalogProject({
    slug: "yeastcoast",
    hash: "3db3f78",
    isProduction: true,
    jwtSecret: "project-secret-for-tests-32-characters",
    lifecycleState: "archived",
    transport: async () => {
      calls += 1;
      return 200;
    },
  });
  assert.equal(v2, false);
  assert.equal(calls, 0);
});

test("dedicated probes use the container route then the public origin, never the node gateway or /health", async () => {
  const seen: string[] = [];
  const plan = buildTenantProbePlan({
    slug: "yeastcoast",
    hash: "ffca33f",
    isProduction: true,
    mode: "v1_dedicated",
    gatewayBases: ["http://flux-node-gateway:4000"],
  });
  assert.deepEqual(
    plan.map((target) => target.kind),
    ["dedicated-container", "public"],
  );
  assert.equal(plan[0]?.url, "http://flux-ffca33f-yeastcoast-api:3000/");
  for (const target of plan) {
    const path = new URL(target.url).pathname;
    assert.equal(path, DEDICATED_POSTGREST_PROBE_PATH);
    assert.equal(path, "/");
    assert.equal(target.url.includes("/health"), false);
    assert.equal(target.url.includes("flux-node-gateway"), false);
  }

  const prevGateway = process.env.FLUX_TENANT_PROBE_GATEWAY_URL;
  process.env.FLUX_TENANT_PROBE_GATEWAY_URL = "http://flux-node-gateway:4000";
  try {
    const ok = await probeTenantApiUrl("yeastcoast", "ffca33f", true, "v1_dedicated", {
      transport: async (target) => {
        seen.push(target.url);
        if (target.kind === "dedicated-container") return 200;
        return 502;
      },
    });
    assert.equal(ok, true);
    assert.deepEqual(seen, ["http://flux-ffca33f-yeastcoast-api:3000/"]);
  } finally {
    if (prevGateway === undefined) delete process.env.FLUX_TENANT_PROBE_GATEWAY_URL;
    else process.env.FLUX_TENANT_PROBE_GATEWAY_URL = prevGateway;
  }
});

test("dedicated probe falls back to the public origin when the container route fails", async () => {
  const seen: string[] = [];
  const ok = await probeTenantApiUrl("mailpilot-ai", "02d83e6", true, "v1_dedicated", {
    transport: async (target) => {
      seen.push(`${target.kind} ${new URL(target.url).pathname}`);
      if (target.kind === "public") return 200;
      return null;
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(seen, ["dedicated-container /", "public /"]);
});

test("v2 probes still go through the node gateway with the tenant Host", async () => {
  const prevGateway = process.env.FLUX_TENANT_PROBE_GATEWAY_URL;
  const prevShallow = process.env.FLUX_TENANT_PROBE_SHALLOW;
  process.env.FLUX_TENANT_PROBE_GATEWAY_URL = "http://flux-node-gateway:4000";
  delete process.env.FLUX_TENANT_PROBE_SHALLOW;
  const seen: Array<{ url: string; host?: string }> = [];
  try {
    const ok = await probeV2SharedCatalogProject({
      slug: "lighthouse",
      hash: "97ffa92",
      isProduction: true,
      jwtSecret: "project-secret-for-tests-32-characters",
      lifecycleState: "active",
      transport: async (target) => {
        seen.push({ url: target.url, host: target.headers.host });
        if (target.kind === "gateway") return 200;
        return 500;
      },
    });
    assert.equal(ok, true);
    assert.equal(seen[0]?.url, "http://flux-node-gateway:4000/");
    assert.match(seen[0]?.host ?? "", /^api--lighthouse--97ffa92\./);
    assert.equal(seen.length, 1);
  } finally {
    if (prevGateway === undefined) delete process.env.FLUX_TENANT_PROBE_GATEWAY_URL;
    else process.env.FLUX_TENANT_PROBE_GATEWAY_URL = prevGateway;
    if (prevShallow === undefined) delete process.env.FLUX_TENANT_PROBE_SHALLOW;
    else process.env.FLUX_TENANT_PROBE_SHALLOW = prevShallow;
  }
});

test("V2_GATEWAY_AUTH_REQUIRED_ERROR matches gateway contract", () => {
  assert.equal(V2_GATEWAY_AUTH_REQUIRED_ERROR, "authorization required");
});
