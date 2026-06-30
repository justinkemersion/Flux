/**
 * Phase 4 live smoke — CLI parsing and fixture discipline helpers.
 *
 * Kept separate from the script entrypoint so argument validation and migration
 * shape checks are unit-testable without hitting the control plane.
 */

import {
  assertNoopSmokeMigrationSql,
  buildNoopSmokeMigration,
  buildNoopSmokeMigrationSql,
  noopSmokeMigrationFilename,
  type NoopSmokeMigrationArtifact,
} from "./smoke-migration";

export {
  assertNoopSmokeMigrationSql,
  buildNoopSmokeMigration,
  buildNoopSmokeMigrationSql,
  noopSmokeMigrationFilename,
  NOOP_SMOKE_MIGRATION_PREFIX,
  NOOP_SMOKE_MIGRATION_VERSION,
  type NoopSmokeMigrationArtifact,
} from "./smoke-migration";

export const PHASE4_SMOKE_APPLY_ACK_FLAG = "--yes-apply-smoke-migration";
export const PHASE4_SMOKE_ALLOW_NON_FIXTURE_FLAG = "--allow-non-fixture-project";

/** Suggested disposable fixture slug (operator creates once on the control plane). */
export const SUGGESTED_FIXTURE_SLUG = "mcp-smoke-fixture";

const HASH_RE = /^[a-f0-9]{7}$/u;
const FIXTURE_SLUG_RE = /smoke|fixture|test/i;
const FIXTURE_METADATA_RE = /smoke|fixture|test/i;

export type Phase4SmokeParseSuccess = {
  ok: true;
  hash: string;
  slug: string;
  applyAcknowledged: boolean;
  allowNonFixtureProject: boolean;
  slugLooksLikeFixture: boolean;
};

export type Phase4SmokeParseFailure = {
  ok: false;
  error: string;
  exitCode: number;
};

export type Phase4SmokeParseResult = Phase4SmokeParseSuccess | Phase4SmokeParseFailure;

export function slugLooksLikeFixture(slug: string): boolean {
  return FIXTURE_SLUG_RE.test(slug.trim());
}

export function metadataLooksLikeFixture(input: {
  slug?: string;
  description?: string | null;
  brief?: string | null;
  name?: string | null;
}): boolean {
  const blob = [input.slug, input.description, input.brief, input.name]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(" ");
  return FIXTURE_METADATA_RE.test(blob);
}

export function parsePhase4SmokeArgs(argv: readonly string[]): Phase4SmokeParseResult {
  let hash: string | undefined;
  let slug: string | undefined;
  let applyAcknowledged = false;
  let allowNonFixtureProject = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === "--hash") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        return {
          ok: false,
          error: "Missing value for --hash (7-char hex project id).",
          exitCode: 2,
        };
      }
      hash = value.trim().toLowerCase();
      i += 1;
      continue;
    }

    if (arg === "--slug") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        return {
          ok: false,
          error: "Missing value for --slug.",
          exitCode: 2,
        };
      }
      slug = value.trim();
      i += 1;
      continue;
    }

    if (arg === PHASE4_SMOKE_APPLY_ACK_FLAG) {
      applyAcknowledged = true;
      continue;
    }

    if (arg === PHASE4_SMOKE_ALLOW_NON_FIXTURE_FLAG) {
      allowNonFixtureProject = true;
      continue;
    }

    if (arg.startsWith("--")) {
      return { ok: false, error: `Unknown flag: ${arg}`, exitCode: 2 };
    }

    return {
      ok: false,
      error: `Unexpected positional argument "${arg}". Use --hash and --slug only.`,
      exitCode: 2,
    };
  }

  if (!hash) {
    return {
      ok: false,
      error: "Missing required --hash (7-char hex project id).",
      exitCode: 2,
    };
  }

  if (!HASH_RE.test(hash)) {
    return {
      ok: false,
      error: "Invalid --hash: expected 7 lowercase hex characters.",
      exitCode: 2,
    };
  }

  if (!slug) {
    return {
      ok: false,
      error: "Missing required --slug.",
      exitCode: 2,
    };
  }

  const slugLooksLikeFixtureResult = slugLooksLikeFixture(slug);

  if (!slugLooksLikeFixtureResult && !allowNonFixtureProject) {
    return {
      ok: false,
      error: formatNonFixtureSlugRefusal(slug),
      exitCode: 2,
    };
  }

  return {
    ok: true,
    hash,
    slug,
    applyAcknowledged,
    allowNonFixtureProject,
    slugLooksLikeFixture: slugLooksLikeFixtureResult,
  };
}

export function formatNonFixtureSlugRefusal(slug: string): string {
  return [
    `Refusing Phase 4 smoke: slug "${slug}" does not look like a fixture project.`,
    "Use a dedicated fixture slug containing smoke, fixture, or test",
    `(suggested: ${SUGGESTED_FIXTURE_SLUG}).`,
    `To override explicitly, pass ${PHASE4_SMOKE_ALLOW_NON_FIXTURE_FLAG}.`,
  ].join(" ");
}

export function formatNonFixtureSlugOverrideWarning(slug: string): string {
  return [
    `WARNING: continuing against non-fixture slug "${slug}".`,
    "Phase 4+ MCP mutation smoke should use a disposable fixture project only.",
    `Prefer ${SUGGESTED_FIXTURE_SLUG} or another slug containing smoke, fixture, or test.`,
  ].join("\n");
}

export function formatNonFixtureMetadataWarning(input: {
  slug: string;
  hash: string;
}): string {
  return [
    "WARNING: project metadata/description does not mention fixture, smoke, or test.",
    `  Project: ${input.slug} (${input.hash})`,
    "  Mark the project description/brief as a smoke fixture, or use a dedicated fixture project.",
    `  Override remains available via ${PHASE4_SMOKE_ALLOW_NON_FIXTURE_FLAG}.`,
  ].join("\n");
}

/** @deprecated Use noopSmokeMigrationFilename */
export function smokeMigrationFilename(suffix: string): string {
  return noopSmokeMigrationFilename(suffix);
}

/** @deprecated Use buildNoopSmokeMigrationSql */
export function buildSmokeMigrationSql(suffix: string): string {
  return buildNoopSmokeMigrationSql(suffix);
}

/** @deprecated Use assertNoopSmokeMigrationSql */
export function assertHarmlessSmokeMigration(sql: string): void {
  assertNoopSmokeMigrationSql(sql);
}

export function formatMigrationApplyWarning(input: {
  slug: string;
  hash: string;
  filename: string;
}): string {
  return [
    "WARNING: flux.migration.apply will run against a real project.",
    `  Project: ${input.slug} (${input.hash})`,
    `  Migration file: ${input.filename}`,
    "  This writes a real row to the project's migration ledger.",
    "  Do not manually edit or delete that ledger row — treat it as real history.",
    `  Re-run only with ${PHASE4_SMOKE_APPLY_ACK_FLAG} when you accept this.`,
  ].join("\n");
}

export const APPLY_ACK_REFUSAL_MESSAGE =
  `Refusing flux.migration.apply: pass ${PHASE4_SMOKE_APPLY_ACK_FLAG} to acknowledge a real ledger write.`;

export const FIXTURE_PROJECT_DOC = `See plans/mcp/fixture-project.md for operator setup of ${SUGGESTED_FIXTURE_SLUG}.`;
