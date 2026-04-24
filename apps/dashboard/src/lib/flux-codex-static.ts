/**
 * Source of truth for `GET /api/cli/v1/codex` and the Codex AI system prompt.
 *
 * IMPORTANT: Do NOT inject the full object into the AI system prompt.
 * Use FLUX_CODEX_AI_PROMPT_JSON instead — it strips executionModesAndTiers
 * to keep the serialized payload under the Llama 3 8B context limit (~8192 tokens).
 */
export const FLUX_CODEX_JSON = {
  version: 3,
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
  /**
   * Execution modes (v1 vs v2) and product tiers (Free / Pro / Enterprise).
   * Codex must use this section when users ask about tiers, plans, isolation, or roadmap.
   * Full architecture: `docs/flux-v2-architecture.md` in the Flux monorepo.
   */
  executionModesAndTiers: {
    overview:
      "Flux supports two execution strategies in one product: **v1_dedicated** (isolated Postgres + PostgREST containers per project) and **v2_shared** (shared cluster, schema-per-tenant, pooled PostgREST behind a gateway). The CLI and dashboard stay the same; `flux-system.projects.mode` selects the engine. v1 and v2 coexist indefinitely—v2 is not a replacement for v1.",
    v1Dedicated: {
      modeKey: "v1_dedicated",
      summary:
        "One Docker Postgres container and one PostgREST container per project, per-tenant bridge network, Traefik labels for routing. Strongest isolation and the default path for Enterprise / compliance-style workloads.",
      whenToChoose:
        "SOC2/HIPAA-style boundaries, noisy-neighbor guarantees, or when regulations expect dedicated infrastructure.",
    },
    v2Shared: {
      modeKey: "v2_shared",
      summary:
        "Shared PostgreSQL cluster with one schema per tenant (`t_<shortid>_api`) and one role per tenant. PostgREST runs as a small pool (2–4 instances); a gateway resolves hostname → tenant, mints short-lived JWTs, rate-limits, and proxies privately to PostgREST. PgBouncer uses transaction pooling—tenant SQL must be stateless across requests.",
      whenToChoose:
        "Cost-efficient scale, many small tenants, prototypes, and apps that accept cluster-level blast radius mitigated by statement timeouts, connection limits, and gateway rate limits.",
    },
    tierHierarchy:
      "Tiers describe **where data lives** and **how tight operational guardrails are**—not different products. **Free** and **Pro** both target the shared path (`v2_shared`); Pro adds stricter limits. **Enterprise** defaults to dedicated stacks (`v1_dedicated`) for isolation and compliance. Changing tier or mode is explicit in the system database, not inferred only from marketing labels.",
    tiers: {
      free: {
        name: "Free",
        engineMode: "v2_shared",
        isolation:
          "Logical: schema + dedicated DB role per tenant on a shared cluster. Accepts cluster-level blast radius; mitigations include rate limits, statement timeouts, and per-role connection caps.",
        differentiatorsVsPro:
          "Same shared execution path as Pro; Pro tightens caps (rate limits, query cost discipline) for production-style traffic.",
        differentiatorsVsEnterprise:
          "Enterprise gets dedicated containers per project (v1_dedicated)—harder isolation boundary and compliance posture; Free stays on shared infrastructure.",
        useCases:
          "Side projects, learning Flux, early MVPs, experiments with low traffic.",
      },
      pro: {
        name: "Pro",
        engineMode: "v2_shared",
        isolation:
          "Same logical isolation as Free (schema-per-tenant on shared cluster). Stronger operational guardrails: per-tenant rate limiting before the database, stricter connection discipline, statement timeouts tuned for shared reality.",
        differentiatorsVsFree:
          "Same engine mode; higher limits and tighter enforcement so production apps are less likely to disturb neighbors.",
        differentiatorsVsEnterprise:
          "Still shared infrastructure—no dedicated metal per tenant. Enterprise moves to v1_dedicated when isolation or compliance demands it.",
        useCases:
          "Production apps on shared economics, SaaS with moderate scale, teams that outgrew Free limits but do not need dedicated stacks.",
      },
      enterprise: {
        name: "Enterprise",
        engineMode: "v1_dedicated (default)",
        isolation:
          "Dedicated Postgres and PostgREST per project—container boundary, not just schema scoping. This is the compliance boundary when shared infra is unacceptable.",
        differentiatorsVsFreePro:
          "Isolated stacks instead of pooled cluster; higher per-tenant resource cost; maps to the existing Flux mesh model users see today for dedicated tenants.",
        useCases:
          "Regulated industries, HIPAA/SOC2-style requirements, large noisy workloads, or any case where shared-cluster blast radius is unacceptable.",
      },
    },
    cliFuture:
      "Planned CLI shape: `flux create my-app` defaults toward v2_shared; `flux create my-app --mode v1_dedicated` requests a dedicated stack. Until wired end-to-end, provisioning may still reflect the host's current engine rollout—Codex should say 'check dashboard / host docs' if behavior differs.",
    codexInferenceNote:
      "Flux Codex (this assistant) is a resource-constrained control-plane component: inference is rate-limited. It is not unbounded LLM access.",
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
  /**
   * Beginner flow for full-stack developers using the Flux CLI.
   */
  cliStart: {
    installation: {
      command: "curl -sL https://flux.vsl-base.com/install | bash",
      requirements: ["Node.js 20+", "curl"],
      notes: [
        "The installer writes `flux` to ~/.local/bin by default.",
        "Ensure ~/.local/bin is on PATH if `flux` is not found.",
      ],
    },
    authentication: {
      env: {
        FLUX_API_BASE: "https://flux.vsl-base.com/api",
        FLUX_API_TOKEN: "flx_live_…",
      },
      command: "flux login",
      note: "Create API keys in Dashboard Settings -> API keys.",
    },
    firstProject: {
      command: "flux create \"my-app\"",
      followUp: "flux push ./schema.sql",
      result:
        "Provision an isolated Postgres database and PostgREST API endpoint for the project.",
    },
    accessingData: {
      apiUrl:
        "Use the API URL returned by `flux create` as your app's REST base URL.",
      auth:
        "Send the project API key (`anon` or `service_role`) in request headers as required by your app/backend.",
      example: "GET /your_table",
    },
  },
  /**
   * Copy-paste CLI patterns; Codex should cite these verbatim when relevant.
   */
  commonPatterns: {
    exportingForLocalDev: "flux dump my-app --schema-only > local.sql",
    streamingLogs: "flux logs my-app --hash xxxxx",
  },
  commands: {
    authVerify:
      "GET /api/cli/v1/auth/verify — validate Bearer `flx_live_…` key; returns { ok: true, user } (used by `flux login`).",
    create:
      "POST /api/cli/v1/create — provision a new tenant (Postgres + PostgREST) and return summary + secrets.",
    list: "GET /api/cli/v1/list — list projects for the authenticated account.",
    push:
      "POST /api/cli/v1/push — apply a SQL file to a project's database in a transaction and notify PostgREST to reload the schema cache.",
    dump: {
      cliSyntax:
        "flux dump <project> --hash <hash> [options] — positional <project> is the slug (alias: -p/--project <name>); --hash <7-hex> disambiguates when multiple instances share a slug. Stdout stream; redirect to file.",
      flags: {
        schemaOnly: "-s / --schema-only: schema only (pg_dump -s). Mutually exclusive with --data-only.",
        dataOnly: "-d / --data-only: data only (pg_dump -a). Mutually exclusive with --schema-only.",
        clean: "-c / --clean: emit DROP … IF EXISTS before creates for clean replay.",
        publicOnly: "--public-only: dump only the public schema (-n public).",
      },
      restAlternative:
        "GET /api/cli/v1/projects/:hash/dump?schemaOnly=&dataOnly=&clean=&publicOnly= — same payload via HTTP; use after CLI is understood.",
    },
    logs:
      "GET /api/cli/v1/logs?slug=&hash=&service=api|db — stream container logs (SSE) for the PostgREST or Postgres container.",
    reap:
      "POST /api/cli/v1/reap — destroy a project and tear down its containers and volumes (when implemented).",
  },
} as const;

/**
 * Subset of FLUX_CODEX_JSON safe to inject into the AI system prompt.
 *
 * executionModesAndTiers is intentionally excluded: when serialized with
 * JSON.stringify(null, 2) it adds ~900 tokens and pushes the system prompt
 * past the Llama 3 8B context window, causing the model to return no tokens.
 * Tier/engine guidance is handled via inline rules in the system prompt instead.
 */
export const FLUX_CODEX_AI_PROMPT_JSON: Omit<
  typeof FLUX_CODEX_JSON,
  "executionModesAndTiers"
> = (({ executionModesAndTiers: _dropped, ...rest }) => rest)(FLUX_CODEX_JSON);
