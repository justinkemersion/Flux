/**
 * Prompt builders for project-understanding AI (Layer 3).
 * Browser-safe — no server secrets or Docker imports.
 */

import { FLUX_MD_TEMPLATE } from "./flux-md.ts";

export type ProjectAiTableSummary = {
  name: string;
  rowCount: number | null;
  rlsEnabled: boolean;
  columns: string[];
};

export type ProjectAiActivityLine = {
  kind: string;
  summary: string;
  createdAt: string;
};

/** Redacted project facts injected into Workers AI user prompts. */
export type ProjectAiContext = {
  slug: string;
  hash: string;
  name: string;
  mode: "v1_dedicated" | "v2_shared";
  description: string | null;
  operatorBrief: string | null;
  lifecycleState: string;
  existingFluxMd: string | null;
  apiSchema: string | null;
  schemaSummary: {
    tableCount: number;
    tables: ProjectAiTableSummary[];
  } | null;
  schemaNote: string | null;
  recentActivity: ProjectAiActivityLine[];
  appliedMigrationCount: number | null;
  backupTrustSummary: string | null;
};

export type ProjectAiSummaryKind = "brief" | "activity" | "resume";

export const PROJECT_AI_SYSTEM_PROMPT = [
  "You are Flux Project Context Assistant.",
  "Help the user understand and continue a PostgreSQL-backed application project.",
  "Use only the provided project context JSON. Do not invent tables, APIs, or infrastructure.",
  "If context is missing, say what is unknown and suggest safe next steps (flux doctor, flux db inspect, flux push --plan).",
  "Output markdown only. No conversational filler. Be concise and actionable.",
  "Never recommend destructive commands without noting backup requirements.",
  "Do not claim to have changed production state — you only produce text for the user to review.",
].join("\n");

function contextJsonBlock(ctx: ProjectAiContext): string {
  return JSON.stringify(ctx, null, 2);
}

/** Draft FLUX.md from live project context. */
export function buildBriefGenerationUserPrompt(ctx: ProjectAiContext): string {
  return [
    "Generate a complete FLUX.md project brief for this Flux project.",
    "Follow this structure exactly (fill sections from context; use (unknown) when data is missing):",
    "",
    "```markdown",
    FLUX_MD_TEMPLATE.trimEnd(),
    "```",
    "",
    "Rules:",
    "- This is application state for future-me, not a README for contributors.",
    "- Mention runtime mode (v1_dedicated vs v2_shared) and API schema when known.",
    "- List important tables with purpose guesses only when supported by table/column names.",
    "- Safe Operations: include flux push --plan, flux backup create/verify, lifecycle wake/sleep as relevant.",
    "- Do not include secrets, passwords, or JWT values.",
    "",
    "Project context JSON:",
    contextJsonBlock(ctx),
  ].join("\n");
}

/** Summarize recent activity timeline. */
export function buildActivitySummaryUserPrompt(ctx: ProjectAiContext): string {
  return [
    "Summarize this project's recent activity timeline in 3–6 bullet points.",
    "Highlight migrations, backups, lifecycle changes, and anything that affects trust or operability.",
    "End with one suggested next step if warranted.",
    "",
    "Project context JSON:",
    contextJsonBlock(ctx),
  ].join("\n");
}

/** Help resume a dormant or stale project. */
export function buildResumeSummaryUserPrompt(ctx: ProjectAiContext): string {
  return [
    "The user is resuming work on this Flux project (possibly dormant or idle).",
    "Write a short resume brief with sections:",
    "## Where things stand",
    "## Schema & data snapshot",
    "## Recent changes",
    "## Suggested first 15 minutes",
    "",
    "Be practical. Mention wake/lifecycle if project is dormant or archived.",
    "",
    "Project context JSON:",
    contextJsonBlock(ctx),
  ].join("\n");
}

export function buildProjectAiUserPrompt(
  kind: ProjectAiSummaryKind,
  ctx: ProjectAiContext,
): string {
  switch (kind) {
    case "brief":
      return buildBriefGenerationUserPrompt(ctx);
    case "activity":
      return buildActivitySummaryUserPrompt(ctx);
    case "resume":
      return buildResumeSummaryUserPrompt(ctx);
  }
}

export function projectAiKindLabel(kind: ProjectAiSummaryKind): string {
  switch (kind) {
    case "brief":
      return "FLUX.md draft";
    case "activity":
      return "Activity summary";
    case "resume":
      return "Resume brief";
  }
}
