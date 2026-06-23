import "server-only";

import {
  buildProjectAiUserPrompt,
  PROJECT_AI_SYSTEM_PROMPT,
  projectAiKindLabel,
  type ProjectAiContext,
  type ProjectAiSummaryKind,
} from "@flux/core/project-ai-prompts";
import {
  gatherProjectAiContext,
  loadOwnedProjectForAi,
  type ProjectAiLookup,
} from "@/src/lib/project-ai-context";
import type { SystemDb } from "@/src/lib/db";
import { runWorkersAiCompletion } from "@/src/lib/workers-ai-completion";

export type ProjectAiSummaryResult = {
  kind: ProjectAiSummaryKind;
  label: string;
  markdown: string;
  context: ProjectAiContext;
};

export async function generateProjectAiSummary(
  db: SystemDb,
  project: ProjectAiLookup,
  kind: ProjectAiSummaryKind,
): Promise<ProjectAiSummaryResult> {
  const context = await gatherProjectAiContext(db, project);
  const userPrompt = buildProjectAiUserPrompt(kind, context);
  const markdown = await runWorkersAiCompletion(
    [
      { role: "system", content: PROJECT_AI_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    { maxTokens: kind === "brief" ? 3072 : 1024 },
  );

  return {
    kind,
    label: projectAiKindLabel(kind),
    markdown,
    context,
  };
}

export async function generateOwnedProjectAiSummary(
  db: SystemDb,
  input: { slug: string; hash: string; userId: string },
  kind: ProjectAiSummaryKind,
): Promise<ProjectAiSummaryResult> {
  const project = await loadOwnedProjectForAi(db, input);
  if (!project) throw new Error("Project not found");
  return generateProjectAiSummary(db, project, kind);
}
