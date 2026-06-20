import type { FluxCoreContext } from "../runtime/context.ts";
import { queryTenantJsonRows } from "../projects/project-manager/sql.ts";
import {
  assertSchemaInspectionPayloadSize,
  buildSchemaInspectionSummary,
  indexColumnsByTable,
  normalizeInspectionRows,
} from "./normalize.ts";
import {
  buildColumnsSql,
  buildExactRowCountSql,
  buildForeignKeysSql,
  buildGrantsSql,
  buildIndexesSql,
  buildPrimaryKeysSql,
  buildTablesMetaSql,
} from "./sql.ts";
import type {
  InspectTenantSchemaOptions,
  RawColumnRow,
  RawForeignKeyRow,
  RawGrantRow,
  RawIndexRow,
  RawPrimaryKeyRow,
  RawTableMetaRow,
  SchemaInspectionResult,
} from "./types.ts";
import { generateSchemaWarnings } from "./warnings.ts";

const EXACT_ROW_COUNT_MAX_TABLES = 5;
const INSPECT_TOTAL_TIMEOUT_MS = 60_000;

export type TenantCatalogQueryFn = (
  sql: string,
) => Promise<unknown[]>;

function asNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function asString(value: unknown): string {
  return String(value ?? "");
}

export function createTenantCatalogQueryFn(
  ctx: FluxCoreContext,
  slug: string,
  hash: string,
): TenantCatalogQueryFn {
  return (sql) => queryTenantJsonRows(ctx, slug, hash, sql);
}

async function runCatalogQueries(
  queryRows: TenantCatalogQueryFn,
  schema: string,
): Promise<{
  tableMeta: RawTableMetaRow[];
  columns: RawColumnRow[];
  primaryKeys: RawPrimaryKeyRow[];
  foreignKeys: RawForeignKeyRow[];
  grants: RawGrantRow[];
  indexes: RawIndexRow[];
}> {
  const [tableMeta, columns, primaryKeys, foreignKeys, grants, indexes] =
    await Promise.all([
      queryRows(buildTablesMetaSql(schema)),
      queryRows(buildColumnsSql(schema)),
      queryRows(buildPrimaryKeysSql(schema)),
      queryRows(buildForeignKeysSql(schema)),
      queryRows(buildGrantsSql(schema)),
      queryRows(buildIndexesSql(schema)),
    ]);

  return {
    tableMeta: tableMeta as RawTableMetaRow[],
    columns: columns as RawColumnRow[],
    primaryKeys: primaryKeys as RawPrimaryKeyRow[],
    foreignKeys: foreignKeys as RawForeignKeyRow[],
    grants: grants as RawGrantRow[],
    indexes: indexes as RawIndexRow[],
  };
}

/**
 * Fixed catalog introspection for a v1_dedicated tenant (read-only SQL only).
 */
export async function inspectTenantSchema(
  ctx: FluxCoreContext,
  options: InspectTenantSchemaOptions,
  queryRows: TenantCatalogQueryFn = createTenantCatalogQueryFn(
    ctx,
    options.slug,
    options.hash,
  ),
): Promise<SchemaInspectionResult> {
  const schema = options.apiSchema.trim();
  const includeExactCounts = options.includeExactCounts === true;

  const work = async (): Promise<SchemaInspectionResult> => {
    const { tableMeta, columns, primaryKeys, foreignKeys, grants, indexes } =
      await runCatalogQueries(queryRows, schema);

    const exactRowCounts: Record<string, number> = {};

    if (
      includeExactCounts &&
      tableMeta.length > 0 &&
      tableMeta.length <= EXACT_ROW_COUNT_MAX_TABLES
    ) {
      for (const meta of tableMeta) {
        const tableName = asString(meta.table_name);
        const rows = await queryRows(buildExactRowCountSql(schema, tableName));
        const exact = asNumber(
          (rows[0] as { exact_rows?: unknown })?.exact_rows,
        );
        if (exact !== undefined) {
          exactRowCounts[tableName] = exact;
        }
      }
    }

    const { tables, relationships } = normalizeInspectionRows({
      schema,
      tableMeta,
      columns,
      primaryKeys,
      foreignKeys,
      grants,
      indexes,
      exactRowCounts,
    });

    const indexMap = indexColumnsByTable(indexes);
    const warnings = generateSchemaWarnings({ tables, relationships, indexMap });
    const summary = buildSchemaInspectionSummary({ tables, relationships });

    const result: SchemaInspectionResult = {
      mode: "v1_dedicated",
      project: {
        slug: options.slug,
        hash: options.hash,
        ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
        schema,
      },
      inspectedAt: new Date().toISOString(),
      tables,
      relationships,
      warnings,
      summary,
    };

    assertSchemaInspectionPayloadSize(result);
    return result;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<SchemaInspectionResult>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Schema inspection exceeded total timeout")),
          INSPECT_TOTAL_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
