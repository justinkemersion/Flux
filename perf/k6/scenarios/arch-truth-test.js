/**
 * Architecture "truth" test: isolate gateway vs resolver vs upstream (PostgREST/DB)
 * by controlling host patterns, request paths, and per-request tags.
 *
 * Required for meaningful splits:
 * - Set UPSTREAM_BASE to the URL you want to load (gateway entry or PostgREST pool URL).
 * - Set KNOWN_HOST (or HOST) to the tenant API hostname, e.g. api.<slug>.<hash>.<domain> (no https://).
 *   Required when UPSTREAM_BASE is loopback — otherwise k6 sends Host: 127.0.0.1 and the gateway cannot resolve tenants.
 * - Set FLUX_BASE_DOMAIN for resolver_cold (e.g. vsl-base.com). Cold traffic uses Host: <random>-<hash>.<domain> against UPSTREAM_BASE.
 *
 * Optional: TRUTH_SCENARIOS=csv to run a subset. TRUTH_STAGGER_SEC to separate scenario start times.
 *
 * @see docs/gateway-load-testing.md
 */
import http from "k6/http";
import { check } from "k6";

const UPSTREAM_BASE = __ENV.UPSTREAM_BASE || __ENV.BASE_URL || "http://localhost:4000";
const GATEWAY_BASE = __ENV.GATEWAY_BASE || UPSTREAM_BASE;
/** Sent as Host for tenant routing where hostForKnown() applies; aliases: __ENV.HOST. */
const KNOWN_HOST = (__ENV.KNOWN_HOST || __ENV.HOST || "").trim();
const FLUX_BASE_DOMAIN = (__ENV.FLUX_BASE_DOMAIN || "vsl-base.com").toLowerCase();
/** 7-char hex to form <slug>-<hash> first label (resolver miss). */
const COLD_HASH = (__ENV.COLD_HASH || "deadbea").slice(0, 7);

const PATH_GATEWAY = __ENV.TRUTH_PATH_GATEWAY || "/";
const PATH_LIGHT = __ENV.TRUTH_PATH_UPSTREAM_LIGHT || "/";
/** If unset, reuses light path; set TRUTH_PATH_UPSTREAM_HEAVY for a heavier read (e.g. higher limit or join). */
const PATH_HEAVY = __ENV.TRUTH_PATH_UPSTREAM_HEAVY || PATH_LIGHT;

const TIMEOUT = __ENV.TIMEOUT || "10s";
const STAGGER_SEC = Number(__ENV.TRUTH_STAGGER_SEC || 0);
const P95_MAX = __ENV.TRUTH_P95_MS || "3000";

const ALL_SCENARIOS = [
  "gateway_only",
  "resolver_hot",
  "resolver_cold",
  "upstream_light",
  "upstream_heavy",
  "overload_shed",
];

function loadTestHeaders() {
  const h = {};
  if ((__ENV.LOAD_TEST_HEADER || "").toLowerCase() === "true") {
    h["x-load-test"] = "true";
    if (__ENV.LOAD_TEST_KEY) h["x-load-test-key"] = __ENV.LOAD_TEST_KEY;
  }
  return h;
}

function parseScenarioFilter() {
  const raw = (__ENV.TRUTH_SCENARIOS || "").trim();
  if (!raw || raw === "all") return new Set(ALL_SCENARIOS);
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Scenarios that call getTagged(..., hostForKnown()) — need real tenant Host on loopback. */
const SCENARIOS_REQUIRING_KNOWN_HOST = new Set([
  "gateway_only",
  "resolver_hot",
  "upstream_light",
  "upstream_heavy",
  "overload_shed",
]);

function upstreamHostnameLooksLoopback(base) {
  try {
    const h = new URL(base).hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    return false;
  }
}

function assertKnownHostWhenLoopback(scenarioFilter) {
  const loopback =
    upstreamHostnameLooksLoopback(UPSTREAM_BASE) || upstreamHostnameLooksLoopback(GATEWAY_BASE);
  if (!loopback || KNOWN_HOST) return;
  const needsTenantHost = [...scenarioFilter].some((s) => SCENARIOS_REQUIRING_KNOWN_HOST.has(s));
  if (!needsTenantHost) return;
  throw new Error(
    "[arch-truth-test] UPSTREAM_BASE/BASE_URL uses loopback without KNOWN_HOST or HOST — " +
      "k6 sends Host: 127.0.0.1 and the Flux gateway cannot resolve a tenant. " +
      'Export KNOWN_HOST="api.<slug>.<hash>.your-base-domain" (no scheme).',
  );
}

function randomColdHost() {
  const rand = Math.random().toString(16).slice(2, 8);
  return `t${rand}-${COLD_HASH}.${FLUX_BASE_DOMAIN}`;
}

/**
 * @param {string} base
 * @param {string} path
 * @param {string} [hostOverride]  If set, forces this Host (for resolver / multi-tenant edge).
 * @param {Record<string, string>} tags
 */
function getTagged(base, path, hostOverride, tags) {
  const url = `${String(base).replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = { ...loadTestHeaders() };
  if (hostOverride) headers.Host = hostOverride;
  return http.get(url, {
    headers,
    timeout: TIMEOUT,
    tags: { ...tags, arch_layer: tags.layer, arch_scenario: tags.scenario },
  });
}

function hostForKnown() {
  return KNOWN_HOST || undefined;
}

// --- scenario impls (names match options.scenarios[].exec) ---

export function gatewayOnly() {
  const res = getTagged(GATEWAY_BASE, PATH_GATEWAY, hostForKnown(), {
    layer: "gateway",
    scenario: "gateway_only",
    mix: "minimal",
  });
  check(res, {
    "gateway 2xx or health": (r) => r.status >= 200 && r.status < 300,
  });
}

export function resolverHot() {
  const h = hostForKnown();
  const res = getTagged(UPSTREAM_BASE, PATH_LIGHT, h, {
    layer: "resolver+upstream",
    scenario: "resolver_hot",
    mix: "hot_cache",
  });
  check(res, {
    "hot ok": (r) => r.status === 200,
  });
}

export function resolverCold() {
  const coldHost = randomColdHost();
  const res = getTagged(UPSTREAM_BASE, PATH_LIGHT, coldHost, {
    layer: "resolver",
    scenario: "resolver_cold",
    mix: "cache_miss",
  });
  check(res, {
    "cold handled 404/200": (r) => r.status === 404 || r.status === 200,
  });
}

export function upstreamLight() {
  const h = hostForKnown();
  const res = getTagged(UPSTREAM_BASE, PATH_LIGHT, h, {
    layer: "upstream",
    scenario: "upstream_light",
    mix: "read_light",
  });
  check(res, {
    "light ok": (r) => r.status === 200,
  });
}

export function upstreamHeavy() {
  const h = hostForKnown();
  const res = getTagged(UPSTREAM_BASE, PATH_HEAVY, h, {
    layer: "upstream",
    scenario: "upstream_heavy",
    mix: "read_heavy",
  });
  check(res, {
    "heavy ok or shed": (r) => r.status === 200 || r.status === 503,
  });
}

export function overload() {
  const h = hostForKnown();
  const res = getTagged(UPSTREAM_BASE, PATH_LIGHT, h, {
    layer: "full_stack",
    scenario: "overload_shed",
    mix: "overload",
  });
  check(res, {
    "ok or 503": (r) => r.status === 200 || r.status === 503,
  });
}

// --- k6 options ---

function buildScenarios(filter) {
  const defs = {
    gateway_only: {
      executor: "constant-arrival-rate",
      rate: Number(__envRate("GATEWAY_ONLY_RATE", 2000)),
      timeUnit: "1s",
      duration: __envDur("GATEWAY_ONLY_DURATION", "60s"),
      preAllocatedVUs: Number(__envVU("GATEWAY_ONLY_PRE_VU", 200)),
      maxVUs: Number(__envVU("GATEWAY_ONLY_MAX_VU", 500)),
      exec: "gatewayOnly",
    },
    resolver_hot: {
      executor: "constant-arrival-rate",
      rate: Number(__envRate("RESOLVER_HOT_RATE", 2000)),
      timeUnit: "1s",
      duration: __envDur("RESOLVER_HOT_DURATION", "60s"),
      preAllocatedVUs: Number(__envVU("RESOLVER_HOT_PRE_VU", 200)),
      maxVUs: Number(__envVU("RESOLVER_HOT_MAX_VU", 500)),
      exec: "resolverHot",
    },
    resolver_cold: {
      executor: "constant-arrival-rate",
      rate: Number(__envRate("RESOLVER_COLD_RATE", 1000)),
      timeUnit: "1s",
      duration: __envDur("RESOLVER_COLD_DURATION", "60s"),
      preAllocatedVUs: Number(__envVU("RESOLVER_COLD_PRE_VU", 200)),
      maxVUs: Number(__envVU("RESOLVER_COLD_MAX_VU", 500)),
      exec: "resolverCold",
    },
    upstream_light: {
      executor: "constant-arrival-rate",
      rate: Number(__envRate("UPSTREAM_LIGHT_RATE", 1500)),
      timeUnit: "1s",
      duration: __envDur("UPSTREAM_LIGHT_DURATION", "60s"),
      preAllocatedVUs: Number(__envVU("UPSTREAM_LIGHT_PRE_VU", 200)),
      maxVUs: Number(__envVU("UPSTREAM_LIGHT_MAX_VU", 500)),
      exec: "upstreamLight",
    },
    upstream_heavy: {
      executor: "ramping-arrival-rate",
      startRate: Number(__envRate("UPSTREAM_HEAVY_START_RATE", 500)),
      timeUnit: "1s",
      stages: [
        { target: Number(__envRate("UPSTREAM_HEAVY_S1", 2000)), duration: __envDur("UPSTREAM_HEAVY_S1D", "30s") },
        { target: Number(__envRate("UPSTREAM_HEAVY_S2", 4000)), duration: __envDur("UPSTREAM_HEAVY_S2D", "30s") },
        { target: Number(__envRate("UPSTREAM_HEAVY_S3", 6000)), duration: __envDur("UPSTREAM_HEAVY_S3D", "30s") },
      ],
      preAllocatedVUs: Number(__envVU("UPSTREAM_HEAVY_PRE_VU", 500)),
      maxVUs: Number(__envVU("UPSTREAM_HEAVY_MAX_VU", 2000)),
      exec: "upstreamHeavy",
    },
    overload_shed: {
      executor: "ramping-arrival-rate",
      startRate: Number(__envRate("OVERLOAD_START_RATE", 2000)),
      timeUnit: "1s",
      stages: [
        { target: Number(__envRate("OVERLOAD_S1", 5000)), duration: __envDur("OVERLOAD_S1D", "30s") },
        { target: Number(__envRate("OVERLOAD_S2", 10000)), duration: __envDur("OVERLOAD_S2D", "30s") },
      ],
      preAllocatedVUs: Number(__envVU("OVERLOAD_PRE_VU", 1000)),
      maxVUs: Number(__envVU("OVERLOAD_MAX_VU", 3000)),
      exec: "overload",
    },
  };

  const enabled = filter;
  const out = {};
  let i = 0;
  for (const name of ALL_SCENARIOS) {
    if (!filter.has(name) || !defs[name]) continue;
    const start = STAGGER_SEC * i;
    out[name] = { ...defs[name] };
    if (start > 0) out[name].startTime = `${start}s`;
    i += 1;
  }
  return out;
}

function __envRate(k, d) {
  return __ENV[k] || d;
}
function __envDur(k, d) {
  return __ENV[k] || d;
}
function __envVU(k, d) {
  return __ENV[k] || d;
}

const filter = parseScenarioFilter();
assertKnownHostWhenLoopback(filter);
const _scenarios = buildScenarios(filter);
if (Object.keys(_scenarios).length === 0) {
  throw new Error(
    "[arch-truth-test] No scenarios enabled. Set TRUTH_SCENARIOS to a subset of: " + ALL_SCENARIOS.join(", "),
  );
}

export const options = {
  scenarios: _scenarios,
  thresholds: {
    http_req_failed: ["rate<0.2"],
    http_req_duration: [`p(95)<${P95_MAX}`],
  },
};
