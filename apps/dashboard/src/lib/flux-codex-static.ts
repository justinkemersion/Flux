/**
 * Source of truth for `GET /api/cli/v1/codex` and the Codex AI system prompt.
 */
export const FLUX_CODEX_JSON = {
  version: 1,
  title: "Flux Codex — Core Rules",
  deterministicPassword: {
    summary:
      "Tenant Postgres passwords for dev/staging may be derived from a server secret and tenant volume name using HMAC-SHA256 (see @flux/core deriveTenantPostgresPasswordFromSecret).",
    algorithm: "HMAC-SHA256",
    inputs: [
      "Server-side FLUX_DEV_POSTGRES_PASSWORD or FLUX_PROJECT_PASSWORD_SECRET",
      "Docker volume name flux-{hash}-{slug}-db-data (tenant PG data directory)",
    ],
    output:
      "Hex digest of the HMAC truncated to 32 characters used as the Postgres superuser password when the secret is set (must match the running container if checked).",
    note: "Production stacks may use a random password instead; the control plane reads it from the running container for operations.",
  },
  hashingConvention: {
    pattern: "flux-{hash}-{slug}",
    description:
      "Docker container names and related identifiers use a flux- prefix, a 7-character lowercase hex hash segment, and the URL-safe project slug, joined with hyphens.",
    examples: ["flux-a1b2c3d-myapp", "flux-0f1e2d3-demo"],
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
