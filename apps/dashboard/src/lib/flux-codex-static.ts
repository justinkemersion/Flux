/**
 * Source of truth for `GET /api/cli/v1/codex` and the Codex AI system prompt.
 */
export const FLUX_CODEX_JSON = {
  version: 1,
  title: "Flux Codex — Core Rules",
  deterministicPassword: {
    summary:
      "Tenant Postgres passwords for dev/staging: HMAC-SHA256 where the HMAC *key* is the master server secret and the *message* is the UTF-8 tenant data volume name (see @flux/core deriveTenantPostgresPasswordFromSecret).",
    algorithm: "HMAC-SHA256",
    hmacKey: "FLUX_DEV_POSTGRES_PASSWORD or FLUX_PROJECT_PASSWORD_SECRET (trimmed, as the HMAC key in Node’s createHmac).",
    hmacMessage: "Exact Docker volume name, e.g. flux-{hash}-{slug}-db-data (tenant PG data).",
    output:
      "Hex encoding of the digest, first 32 characters, used as POSTGRES_PASSWORD (must match the running container if checked).",
    note: "Production stacks may use a random password instead; the control plane reads it from the running container for operations.",
  },
  hashingConvention: {
    pattern: "flux-{hash}-{slug}",
    description:
      "Docker container names and related identifiers use a flux- prefix, a 7-character lowercase hex hash segment, and the URL-safe project slug, joined with hyphens.",
    examples: ["flux-a1b2c3d-myapp", "flux-0f1e2d3-demo"],
  },
  /**
   * The Determinism rule: what users control vs what the orchestrator stamps.
   */
  determinism: {
    slug: "The project slug is user-chosen (normalized to a URL-safe name in the engine).",
    hash: "A 7-character lowercase hex id is assigned by the orchestrator at provision time; it is not user-editable. It appears in hostnames, Docker resource names, and Traefik labels.",
  },
  lifecycleOperations: {
    stop:
      "STOP: halt PostgREST and Postgres containers (API first, then DB). **Standby** — data volumes and catalog row remain; project is not decommissioned.",
    start:
      "START: start DB, wait for readiness, then start PostgREST. **Operational** — resumes existing infrastructure; does not re-provision from scratch.",
    repair:
      "REPAIR: re-provision the tenant from the current environment when the stack is missing, partial, or corrupt. **Destructive** to that project’s on-disk data — new empty database for the same slug/hash metadata.",
    nuke:
      "NUKE: atomic infrastructure purge — remove both tenant containers, delete the named data volume, remove per-tenant network, then delete the catalog row. **Irreversible**; not the same as STOP (power).",
  },
  /**
   * Dashboard: operators use the same auth session. Point users to UI for at-a-glance and deep checks.
   */
  dashboard: {
    controlRoom:
      "The Dashboard Projects page includes a **Control Room** / fleet strip: per-project health dots, aggregate RUN/DEG/ERR, and a **Node Status** readout (Engine container count, host RAM %, 1m load) — server-rack style telemetry for the node running the control plane.",
    fleetTelemetry:
      "**Fleet** status comes from the catalog + Docker: mesh heartbeat history (telemetry sparkline), and project rows with health_status / last_heartbeat. Use the overview to spot degraded or error projects before the CLI.",
    meshReadout:
      "Opening a project in the UI shows the **Mesh Readout**: connection manifest (API URL, Postgres), live log stream, and the heartbeat block strip. For deep diagnosis (not just `flux logs`), direct users to the Dashboard project detail or `flux open <name>` to open the Mesh view in the browser when available.",
  },
  commands: {
    authVerify:
      "GET /api/cli/v1/auth/verify — validate Bearer `flx_live_…` key; returns { ok: true, user } (used by `flux login`).",
    create:
      "POST /api/cli/v1/create — provision a new tenant (Postgres + PostgREST) and return summary + secrets.",
    list: "GET /api/cli/v1/list — list projects for the authenticated account.",
    push:
      "POST /api/cli/v1/push — apply a SQL file to a project's database in a transaction and notify PostgREST to reload the schema cache.",
    logs:
      "GET /api/cli/v1/logs?slug=&hash=&service=api|db — stream container logs (SSE) for the PostgREST or Postgres container.",
    reap:
      "POST /api/cli/v1/reap — destroy a project and tear down its containers and volumes (when implemented).",
  },
} as const;
