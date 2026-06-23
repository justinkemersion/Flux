/**
 * Control-plane project metadata — short description and optional operator brief.
 * Distinct from repo-level FLUX.md (Phase 11).
 */

export const PROJECT_DESCRIPTION_MAX_LEN = 280;
export const PROJECT_BRIEF_MAX_LEN = 8000;

export type ProjectMetadataFields = {
  description: string | null;
  brief: string | null;
};

export type ProjectMetadataPatch = {
  description?: string | null;
  brief?: string | null;
};

export class ProjectMetadataValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectMetadataValidationError";
  }
}

function normalizeOptionalText(
  value: string | null | undefined,
  maxLen: number,
  label: string,
): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) {
    throw new ProjectMetadataValidationError(
      `${label} must be at most ${String(maxLen)} characters.`,
    );
  }
  return trimmed;
}

/** Validates and normalizes description + brief for storage. */
export function normalizeProjectMetadataPatch(
  patch: ProjectMetadataPatch,
): ProjectMetadataFields {
  const out: ProjectMetadataFields = {
    description: null,
    brief: null,
  };
  if ("description" in patch) {
    out.description = normalizeOptionalText(
      patch.description,
      PROJECT_DESCRIPTION_MAX_LEN,
      "description",
    );
  }
  if ("brief" in patch) {
    out.brief = normalizeOptionalText(
      patch.brief,
      PROJECT_BRIEF_MAX_LEN,
      "brief",
    );
  }
  return out;
}

/** Merge a patch onto existing metadata (only keys present in patch are updated). */
export function mergeProjectMetadata(
  existing: ProjectMetadataFields,
  patch: ProjectMetadataPatch,
): ProjectMetadataFields {
  const normalized = normalizeProjectMetadataPatch(patch);
  return {
    description:
      "description" in patch ? normalized.description : existing.description,
    brief: "brief" in patch ? normalized.brief : existing.brief,
  };
}

export function formatProjectMetadataCliBlock(
  slug: string,
  hash: string,
  meta: ProjectMetadataFields,
): string[] {
  const lines = [`Project ${slug} (${hash})`];
  lines.push(
    meta.description?.trim()
      ? `Description: ${meta.description.trim()}`
      : "Description: (not set)",
  );
  if (meta.brief?.trim()) {
    lines.push("Brief:");
    for (const line of meta.brief.trim().split("\n")) {
      lines.push(`  ${line}`);
    }
  } else {
    lines.push("Brief: (not set)");
  }
  return lines;
}
