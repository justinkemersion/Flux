import { LEGACY_FLUX_API_SCHEMA } from "./api-schema-strategy.ts";

export type V2PushSqlRewriteInput = {
  tenantSchema: string;
  tenantRole: string;
};

/**
 * Derives `t_<12hex>_role` from a pooled tenant API schema name.
 */
export function tenantRoleFromApiSchema(tenantSchema: string): string {
  const match = /^t_([0-9a-f]{12})_api$/u.exec(tenantSchema.trim());
  if (!match) {
    throw new Error(
      `Cannot derive tenant role from API schema "${tenantSchema}" (expected t_<12hex>_api)`,
    );
  }
  return `t_${match[1]}_role`;
}

/**
 * Rewrites app-facing v2_shared push SQL into tenant-scoped equivalents.
 *
 * Execution also sets `SET LOCAL search_path TO <tenantSchema>, public`, so
 * unqualified object names resolve to the tenant API schema first. This rewrite
 * handles explicit Foundry / Supabase-style references:
 *
 * - `authenticated` role → tenant role (`t_<12hex>_role`)
 * - `SCHEMA public` / `SCHEMA api` → tenant API schema
 * - qualified `public.` object prefixes → `<tenantSchema>.`
 */
export function rewriteV2TenantPushSql(
  sql: string,
  input: V2PushSqlRewriteInput,
): string {
  return rewriteOutsideSingleQuotedStrings(sql, (segment) =>
    rewriteV2TenantPushSegment(segment, input),
  );
}

function rewriteOutsideSingleQuotedStrings(
  sql: string,
  rewriteSegment: (segment: string) => string,
): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      out += sql[i];
      i += 1;
      while (i < sql.length) {
        out += sql[i];
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += sql[i + 1];
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    const nextQuote = sql.indexOf("'", i);
    const segment = nextQuote === -1 ? sql.slice(i) : sql.slice(i, nextQuote);
    out += rewriteSegment(segment);
    i = nextQuote === -1 ? sql.length : nextQuote;
  }
  return out;
}

function rewriteV2TenantPushSegment(
  segment: string,
  input: V2PushSqlRewriteInput,
): string {
  const { tenantSchema, tenantRole } = input;
  let out = segment;

  out = out.replace(
    /\b(?:ON|IN)\s+SCHEMA\s+public\b/giu,
    (match) => match.replace(/\bpublic\b/iu, tenantSchema),
  );
  out = out.replace(
    new RegExp(
      `\\b(?:ON|IN)\\s+SCHEMA\\s+${LEGACY_FLUX_API_SCHEMA}\\b`,
      "giu",
    ),
    (match) =>
      match.replace(
        new RegExp(`\\b${LEGACY_FLUX_API_SCHEMA}\\b`, "iu"),
        tenantSchema,
      ),
  );
  out = out.replace(
    /\bGRANT\s+USAGE\s+ON\s+SCHEMA\s+public\b/giu,
    `GRANT USAGE ON SCHEMA ${tenantSchema}`,
  );
  out = out.replace(
    new RegExp(
      `\\bGRANT\\s+USAGE\\s+ON\\s+SCHEMA\\s+${LEGACY_FLUX_API_SCHEMA}\\b`,
      "giu",
    ),
    `GRANT USAGE ON SCHEMA ${tenantSchema}`,
  );
  out = out.replace(/\bpublic\./giu, `${tenantSchema}.`);
  out = out.replace(
    new RegExp(`\\b${LEGACY_FLUX_API_SCHEMA}\\.`, "giu"),
    `${tenantSchema}.`,
  );
  out = out.replace(/\bauthenticated\b/giu, tenantRole);

  return out;
}
