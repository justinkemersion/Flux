/**
 * Phase 4 live smoke — CLI parsing and harmless migration helpers.
 *
 * Kept separate from the script entrypoint so argument validation and migration
 * shape checks are unit-testable without hitting the control plane.
 */

export const PHASE4_SMOKE_APPLY_ACK_FLAG = "--yes-apply-smoke-migration";

const HASH_RE = /^[a-f0-9]{7}$/u;

const FORBIDDEN_MIGRATION_PATTERNS = [
  /\bCREATE\b/i,
  /\bALTER\b/i,
  /\bDROP\b/i,
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\b/i,
  /\bTRUNCATE\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
] as const;

export type Phase4SmokeParseSuccess = {
  ok: true;
  hash: string;
  slug: string;
  applyAcknowledged: boolean;
};

export type Phase4SmokeParseFailure = {
  ok: false;
  error: string;
  exitCode: number;
};

export type Phase4SmokeParseResult = Phase4SmokeParseSuccess | Phase4SmokeParseFailure;

export function parsePhase4SmokeArgs(argv: readonly string[]): Phase4SmokeParseResult {
  let hash: string | undefined;
  let slug: string | undefined;
  let applyAcknowledged = false;

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

  return { ok: true, hash, slug, applyAcknowledged };
}

export function smokeMigrationFilename(suffix: string): string {
  return `9999_mcp_smoke_${suffix}.sql`;
}

/** Harmless smoke migration: comment + read-only SELECT only. */
export function buildSmokeMigrationSql(suffix: string): string {
  return `-- flux mcp phase4 smoke ${suffix}\nSELECT version();\n`;
}

export function assertHarmlessSmokeMigration(sql: string): void {
  for (const pattern of FORBIDDEN_MIGRATION_PATTERNS) {
    if (pattern.test(sql)) {
      throw new Error(`Smoke migration must not contain ${String(pattern)} statements.`);
    }
  }
  if (!/\bSELECT\s+version\s*\(\s*\)\s*;/iu.test(sql)) {
    throw new Error("Smoke migration must include SELECT version();");
  }
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
