/**
 * MCP prompts for repeatable agent workflows.
 */

export const FLUX_MCP_PROMPTS = [
  {
    name: "flux.production_readiness",
    description:
      "Checklist workflow: run doctor, review backup trust, migration ledger, and production hardening docs.",
    arguments: [{ name: "hash", description: "Project hash (7 hex chars).", required: true }],
  },
  {
    name: "flux.migration_review",
    description:
      "Plan-first migration review: inspect schema, list applied migrations, plan local SQL, never apply without explicit capability.",
    arguments: [
      { name: "hash", description: "Project hash (7 hex chars).", required: true },
      {
        name: "migrationsPath",
        description: 'Relative migrations directory (e.g. "migrations").',
        required: false,
      },
    ],
  },
  {
    name: "flux.rls_debug",
    description:
      "RLS and grants debugging: inspect schema policies, grants, and common footguns for pooled v2_shared projects.",
    arguments: [
      { name: "hash", description: "Project hash (7 hex chars).", required: true },
      { name: "table", description: "Optional table name to focus on.", required: false },
    ],
  },
  {
    name: "flux.nextjs_app_setup",
    description:
      "Wire a Next.js app to Flux: canonical API URL, tenant schema, JWT role, and bundled nextjs guide.",
    arguments: [{ name: "hash", description: "Project hash (7 hex chars).", required: true }],
  },
  {
    name: "flux.backup_before_migration",
    description:
      "Safe apply loop: plan → ensure verified backup → destructive preflight → apply (only with migration:apply capability).",
    arguments: [{ name: "hash", description: "Project hash (7 hex chars).", required: true }],
  },
  {
    name: "flux.project_brief_refresh",
    description:
      "Review FLUX.md / project brief context and advisories from flux.project.describe.",
    arguments: [{ name: "hash", description: "Project hash (7 hex chars).", required: true }],
  },
] as const;

export type FluxMcpPromptName = (typeof FLUX_MCP_PROMPTS)[number]["name"];

function requireArg(args: Record<string, string> | undefined, key: string): string {
  const value = args?.[key]?.trim();
  if (!value) {
    throw new Error(`Missing required prompt argument: ${key}`);
  }
  return value;
}

function optionalArg(args: Record<string, string> | undefined, key: string): string | undefined {
  const value = args?.[key]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function renderFluxPrompt(
  name: FluxMcpPromptName,
  args?: Record<string, string>,
): { description: string; messages: Array<{ role: "user"; content: { type: "text"; text: string } }> } {
  switch (name) {
    case "flux.production_readiness": {
      const hash = requireArg(args, "hash");
      return {
        description: "Production readiness checklist for a Flux project.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `# Flux production readiness — project ${hash}`,
                "",
                "Follow this read-only workflow:",
                "1. Read resource `flux://projects/" + hash + "/doctor` or call tool `flux.doctor`.",
                "2. Read resource `flux://projects/" + hash + "/backups` or call `flux.backup.list`.",
                "3. Call `flux.migrations.list` and confirm ledger matches repo migrations.",
                "4. Read `flux://docs/guides/backups` and `flux://docs/guides/migrations`.",
                "5. Summarize blockers before any mutation. Do not apply migrations or destructive ops without operator approval.",
              ].join("\n"),
            },
          },
        ],
      };
    }
    case "flux.migration_review": {
      const hash = requireArg(args, "hash");
      const migrationsPath = optionalArg(args, "migrationsPath") ?? "migrations";
      return {
        description: "Migration plan review (plan-only by default).",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `# Migration review — project ${hash}`,
                "",
                "1. `flux.schema.inspect` and `flux.migrations.list`.",
                `2. \`flux.migration.plan\` with migrationsPath "${migrationsPath}".`,
                "3. Report apply/skip/conflicts and destructive-shaped warnings.",
                "4. Do NOT call `flux.migration.apply` unless the token has `migration:apply` and backup trust passes.",
              ].join("\n"),
            },
          },
        ],
      };
    }
    case "flux.rls_debug": {
      const hash = requireArg(args, "hash");
      const table = optionalArg(args, "table");
      return {
        description: "RLS and grants debugging workflow.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `# RLS debug — project ${hash}${table ? ` / table ${table}` : ""}`,
                "",
                "1. Read `flux://projects/" + hash + "/schema` or call `flux.schema.inspect`.",
                "2. Check RLS enabled flags, policies, and GRANTs for tenant role.",
                "3. On v2_shared: tables live in `t_<shortId>_api`, JWT role must be `t_<shortId>_role`.",
                "4. Read bundled docs at `flux://docs/guides/mcp` for profile headers if bypassing gateway.",
                table ? `5. Focus analysis on table \`${table}\`.` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          },
        ],
      };
    }
    case "flux.nextjs_app_setup": {
      const hash = requireArg(args, "hash");
      return {
        description: "Next.js + Flux bootstrap checklist.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `# Next.js app setup — project ${hash}`,
                "",
                "1. `flux.project.describe` for API URL and schema name.",
                "2. Read `flux://docs/guides/mcp` and repo AGENTS.md footguns (triple-dash host, tenant schema, grants).",
                "3. Never embed long-lived JWT secrets in client bundles; mint server-side HS256 JWTs.",
                "4. Use gateway or send Accept-Profile / Content-Profile for direct PostgREST calls.",
              ].join("\n"),
            },
          },
        ],
      };
    }
    case "flux.backup_before_migration": {
      const hash = requireArg(args, "hash");
      return {
        description: "Backup-gated migration apply loop.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `# Backup before migration — project ${hash}`,
                "",
                "Strict sequence:",
                "1. `flux.migration.plan`",
                "2. `flux.backup.ensureVerified`",
                "3. `flux.destructive.preflight`",
                "4. `flux.migration.apply` only if steps 1–3 pass AND token has migration:apply.",
                "",
                "Never skip backup verification. Never use destructive lifecycle MCP tools (blocked).",
              ].join("\n"),
            },
          },
        ],
      };
    }
    case "flux.project_brief_refresh": {
      const hash = requireArg(args, "hash");
      return {
        description: "Refresh agent context from FLUX.md and project metadata.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `# Project brief refresh — ${hash}`,
                "",
                "1. Call `flux.project.describe` and note advisories (agent_context_missing, plan_limit_exceeded).",
                "2. Read resource `flux://projects/" + hash + "` for metadata + brief.",
                "3. If brief missing, recommend operator run `flux project brief generate` / push from CLI (not via MCP).",
              ].join("\n"),
            },
          },
        ],
      };
    }
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown prompt: ${String(_exhaustive)}`);
    }
  }
}

export function isFluxMcpPromptName(name: string): name is FluxMcpPromptName {
  return FLUX_MCP_PROMPTS.some((prompt) => prompt.name === name);
}
