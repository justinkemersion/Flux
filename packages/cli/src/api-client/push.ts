import type { ImportSqlFileResult } from "@flux/core/standalone";
import type { MigrationPushMeta } from "@flux/core/sql-migrations";
import type { RepeatablePushMeta } from "@flux/core/sql-repeatable-scripts";
import { readFile, stat } from "node:fs/promises";
import type { ApiClientContext } from "./context";
import {
  errorMessageFromJsonBody,
  parseJsonResponseBody,
} from "./json-response";
import { pushSqlResponseSchema } from "./schemas";

export type PushSqlResult = ImportSqlFileResult & {
  skipped?: boolean;
  previousChecksum?: string;
};

export async function pushSql(
  ctx: ApiClientContext,
  input: {
    slug: string;
    hash: string;
    sql: string;
    migration?: MigrationPushMeta;
    repeatable?: RepeatablePushMeta;
  },
): Promise<PushSqlResult> {
  const token = ctx.tokenOrThrow();
  const url = `${ctx.baseUrl}/cli/v1/push`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      slug: input.slug.trim(),
      hash: input.hash.trim().toLowerCase(),
      sql: input.sql,
      ...(input.migration ? { migration: input.migration } : {}),
      ...(input.repeatable ? { repeatable: input.repeatable } : {}),
    }),
  });
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  const text = await res.text();
  const raw = parseJsonResponseBody(
    text,
    `CLI push: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
  );
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(raw, res.status));
  }
  const parsed = pushSqlResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      "CLI push: response did not match expected ImportSqlFileResult shape.",
    );
  }
  return {
    tablesMoved: parsed.data.tablesMoved,
    sequencesMoved: parsed.data.sequencesMoved,
    viewsMoved: parsed.data.viewsMoved,
    ...(("skipped" in (raw as object) &&
      typeof (raw as { skipped?: unknown }).skipped === "boolean")
      ? { skipped: (raw as { skipped: boolean }).skipped }
      : {}),
    ...(("previousChecksum" in (raw as object) &&
      typeof (raw as { previousChecksum?: unknown }).previousChecksum ===
        "string")
      ? {
          previousChecksum: (raw as { previousChecksum: string })
            .previousChecksum,
        }
      : {}),
  };
}

export async function importSqlFile(
  ctx: ApiClientContext,
  project: string,
  filePath: string,
  hash: string,
  _options: {
    supabaseCompat: boolean;
    sanitizeForTarget: boolean;
    moveFromPublic: boolean;
    disableRowLevelSecurityInApi?: boolean;
  },
): Promise<ImportSqlFileResult> {
  const s = await stat(filePath);
  if (s.size > 4 * 1024 * 1024) {
    throw new Error(
      "SQL file is larger than 4 MiB (server limit for flux push).",
    );
  }
  const sql = await readFile(filePath, "utf8");
  return pushSql(ctx, { slug: project, hash, sql });
}
