/**
 * Repository-level FLUX.md project brief — distinct from control-plane
 * `projects.description` / `projects.brief` (operator metadata).
 */

export const FLUX_MD_FILENAME = "FLUX.md" as const;
export const FLUX_MD_MAX_LEN = 32_000;

export type FluxMdSnapshot = {
  content: string | null;
  syncedAt: string | null;
};

export type FluxMdGenerationContext = {
  name: string;
  slug: string;
  hash: string;
};

export class FluxMdValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FluxMdValidationError";
  }
}

/** Canonical empty template — users generate the first draft with AI, then edit. */
export const FLUX_MD_TEMPLATE = `# Flux Project Brief

## Purpose

## Current Status

## Runtime

## Data Model

## Important Tables

## User Model

## API Surface

## Integrations

## Safe Operations

## Known Risks

## Next Steps

## Notes for Future Work
`;

export function normalizeFluxMdContent(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > FLUX_MD_MAX_LEN) {
    throw new FluxMdValidationError(
      `FLUX.md must be at most ${String(FLUX_MD_MAX_LEN)} characters.`,
    );
  }
  return trimmed;
}

/** Copyable prompt for Cursor, Codex, or similar tools. */
export function buildFluxMdGenerationPrompt(
  ctx: FluxMdGenerationContext,
): string {
  const lines = [
    `Create a \`${FLUX_MD_FILENAME}\` file at the repository root for this Flux project.`,
    "",
    `Project: ${ctx.name} (slug \`${ctx.slug}\`, hash \`${ctx.hash}\`)`,
    "",
    `${FLUX_MD_FILENAME} is a Flux project brief — not a README. It explains application state and operating assumptions.`,
    "",
    'It should answer: "If future-me wakes this project up in six months, what does he need to know in five minutes?"',
    "",
    "Use this structure (fill in from the codebase, schema, env, and docs):",
    "",
    "```markdown",
    FLUX_MD_TEMPLATE.trimEnd(),
    "```",
    "",
    "After creating the file, sync it to the Flux dashboard with:",
    "",
    `\`flux project brief push --hash ${ctx.hash}\``,
  ];
  return lines.join("\n");
}

export function formatFluxMdCliBlock(input: {
  slug: string;
  hash: string;
  name: string;
  remote: FluxMdSnapshot;
  localFound: boolean;
  localRoot: string | null;
}): string[] {
  const lines = [`Project ${input.slug} (${input.hash}) — ${FLUX_MD_FILENAME}`];
  if (input.remote.content?.trim()) {
    lines.push(
      `Dashboard snapshot: synced${input.remote.syncedAt ? ` (${input.remote.syncedAt})` : ""}`,
    );
  } else {
    lines.push("Dashboard snapshot: (not synced)");
  }
  if (input.localFound) {
    lines.push(
      `Local repo: found at ${input.localRoot ?? "project root"}/${FLUX_MD_FILENAME}`,
    );
  } else if (input.localRoot) {
    lines.push(
      `Local repo: no ${FLUX_MD_FILENAME} in ${input.localRoot} (flux.json present)`,
    );
  } else {
    lines.push(`Local repo: no flux.json found from current directory`);
  }
  return lines;
}

/** Short explainer for UI + docs — repo file vs dashboard snapshot. */
export const FLUX_MD_SOURCE_OF_TRUTH_NOTE =
  "The file FLUX.md in your app repo is the long-term source of truth. What you see on the dashboard is a synced copy for quick reorientation.";

/** What `flux project brief push` does (repo → dashboard, one direction). */
export function fluxMdPushCommandExplainer(hash: string): string {
  return `Uploads FLUX.md from your app repo to refresh this dashboard view. It does not download from the dashboard to your repo. Hash: ${hash}.`;
}

/** Edit workflow steps when the dashboard is read-only. */
export function fluxMdEditWorkflowSteps(hash: string): readonly string[] {
  return [
    "Copy this brief or export it from the CLI.",
    "Save or update FLUX.md at your app repo root (next to flux.json).",
    "Edit the file in your editor or with Cursor.",
    `Run flux project brief push --hash ${hash} to update what you see here.`,
  ] as const;
}
