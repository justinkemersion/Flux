import chalk from "chalk";
import type {
  InspectedTable,
  SchemaInspectionResult,
  SchemaWarning,
} from "@flux/core/schema-inspection";
import { B, sectionBanner } from "../cli-layout.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function fmtRows(n: number | undefined): string {
  if (n === undefined || n < 0) return "—";
  return `~${String(n)}`;
}

function fmtRowsExact(n: number | undefined): string {
  if (n === undefined || n < 0) return "—";
  return String(n);
}

function rlsCell(table: InspectedTable): string {
  if (table.rls.enabled) {
    return chalk.green("enabled ");
  }
  return chalk.yellow("disabled");
}

function warnSeverityPrefix(w: SchemaWarning): string {
  if (w.severity === "danger") return chalk.red("! ");
  if (w.severity === "warning") return chalk.yellow("! ");
  return chalk.dim("· ");
}

function printEmptySchema(schema: string): void {
  console.log(chalk.dim(`${B}Schema ${chalk.white(schema)} has no user tables.`));
  console.log(chalk.dim(`${B}Run migrations to create tables, then try again.`));
}

// ---------------------------------------------------------------------------
// flux db inspect
// ---------------------------------------------------------------------------

export function printDbInspect(result: SchemaInspectionResult): void {
  const { project, summary, tables, warnings } = result;

  sectionBanner(`${project.slug}`);

  const mode = result.mode === "v2_shared" ? "v2 shared" : "v1 dedicated";
  console.log(`${B}${chalk.dim("Mode:   ")} ${chalk.white(mode)}`);
  console.log(`${B}${chalk.dim("Schema: ")} ${chalk.white(project.schema)}`);
  console.log();

  if (tables.length === 0) {
    printEmptySchema(project.schema);
    return;
  }

  const totalRows = tables.reduce(
    (acc, t) => acc + (t.estimatedRows ?? 0),
    0,
  );
  console.log(`${B}${chalk.dim("Tables: ")} ${chalk.cyan(String(summary.tableCount))}`);
  console.log(`${B}${chalk.dim("Rows:   ")} ${chalk.white(fmtRows(totalRows))}`);
  console.log();

  // Largest tables (top 5)
  const sorted = [...tables]
    .sort((a, b) => (b.estimatedRows ?? 0) - (a.estimatedRows ?? 0))
    .slice(0, 5);
  console.log(chalk.dim(`${B}Largest tables:`));
  const wName = Math.min(
    Math.max(...sorted.map((t) => t.name.length), 12),
    32,
  );
  for (const t of sorted) {
    const name = chalk.cyan(t.name.padEnd(wName));
    const rows = chalk.white(fmtRows(t.estimatedRows));
    console.log(`${B}  ${name}  ${rows}`);
  }
  console.log();

  // Warnings
  if (warnings.length === 0) {
    console.log(chalk.dim(`${B}Warnings: none`));
  } else {
    console.log(chalk.dim(`${B}Warnings:`));
    for (const w of warnings) {
      const prefix = warnSeverityPrefix(w);
      const loc = w.table ? chalk.dim(` (${w.table})`) : "";
      console.log(`${B}  ${prefix}${chalk.white(w.message)}${loc}`);
    }
  }
  console.log();
}

// ---------------------------------------------------------------------------
// flux db tables
// ---------------------------------------------------------------------------

export function printDbTables(result: SchemaInspectionResult): void {
  const { project, tables } = result;

  sectionBanner(`${project.slug}  —  tables`);

  if (tables.length === 0) {
    printEmptySchema(project.schema);
    return;
  }

  const wName = Math.min(Math.max(...tables.map((t) => t.name.length), 8), 32);
  const wCols = 8;
  const wRows = 10;
  const wRls = 8;

  console.log(
    chalk.dim(
      `${B}${"TABLE".padEnd(wName)}  ${"COLUMNS".padEnd(wCols)}${"ROWS".padEnd(wRows)}RLS`,
    ),
  );
  for (const t of tables) {
    const name = chalk.cyan(t.name.padEnd(wName));
    const cols = String(t.columns.length).padEnd(wCols);
    const rows = fmtRows(t.estimatedRows).padEnd(wRows);
    const rls = rlsCell(t);
    console.log(`${B}${name}  ${chalk.white(cols)}${chalk.white(rows)}${rls}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// flux db describe <table>
// ---------------------------------------------------------------------------

export function printDbDescribe(
  result: SchemaInspectionResult,
  tableName: string,
): void {
  const table = result.tables.find(
    (t) => t.name.toLowerCase() === tableName.toLowerCase(),
  );

  if (!table) {
    const available = result.tables.map((t) => t.name).join(", ") || "(none)";
    throw new Error(
      `Table ${JSON.stringify(tableName)} not found in schema ${JSON.stringify(result.project.schema)}.\n` +
        `Available: ${available}`,
    );
  }

  sectionBanner(`${result.project.slug}  —  ${table.name}`);

  // Columns
  const wCol = Math.min(
    Math.max(...table.columns.map((c) => c.name.length), 8),
    30,
  );
  const wType = Math.min(
    Math.max(...table.columns.map((c) => c.type.length), 8),
    20,
  );

  console.log(chalk.dim(`${B}Columns:`));
  for (const col of table.columns) {
    const pk = table.primaryKey.includes(col.name) ? chalk.bold(" PK") : "";
    const fk = col.isForeignKey ? chalk.dim(" FK") : "";
    const nullable = col.nullable ? chalk.dim("  nullable") : "";
    const def =
      col.defaultValue && col.defaultValue !== "null"
        ? chalk.dim(`  default ${col.defaultValue}`)
        : "";
    console.log(
      `${B}  ${chalk.cyan(col.name.padEnd(wCol))}  ${chalk.white(col.type.padEnd(wType))}${pk}${fk}${nullable}${def}`,
    );
  }
  console.log();

  // Primary key
  if (table.primaryKey.length > 0) {
    console.log(
      `${B}${chalk.dim("Primary key:")}  ${chalk.white(table.primaryKey.join(", "))}`,
    );
    console.log();
  }

  // Foreign keys
  if (table.foreignKeys.length > 0) {
    console.log(chalk.dim(`${B}Foreign keys:`));
    for (const fk of table.foreignKeys) {
      const from = fk.columns.join(", ");
      const to = `${fk.referencedTable}.${fk.referencedColumns.join(", ")}`;
      const onDel = fk.onDelete ? chalk.dim(`  on delete ${fk.onDelete}`) : "";
      console.log(`${B}  ${chalk.cyan(from)}  →  ${chalk.white(to)}${onDel}`);
    }
    console.log();
  }

  // RLS
  const rlsState = table.rls.enabled
    ? chalk.green("enabled")
    : chalk.yellow("disabled");
  console.log(`${B}${chalk.dim("RLS:")}          ${rlsState}`);
  console.log();
}

// ---------------------------------------------------------------------------
// flux db counts
// ---------------------------------------------------------------------------

export function printDbCounts(
  result: SchemaInspectionResult,
  exact: boolean,
): void {
  const { project, tables } = result;

  sectionBanner(`${project.slug}  —  row counts${exact ? " (exact)" : ""}`);

  if (tables.length === 0) {
    printEmptySchema(project.schema);
    return;
  }

  if (exact) {
    console.log(
      chalk.dim(
        `${B}Exact counts from count(*) — may be slower on large tables.`,
      ),
    );
    console.log();
  }

  const sorted = [...tables].sort((a, b) => {
    const ar = a.estimatedRows ?? 0;
    const br = b.estimatedRows ?? 0;
    return br - ar;
  });

  const wName = Math.min(Math.max(...sorted.map((t) => t.name.length), 8), 32);

  for (const t of sorted) {
    const name = chalk.cyan(t.name.padEnd(wName));
    const rows = exact
      ? chalk.white(fmtRowsExact(t.estimatedRows))
      : chalk.white(fmtRows(t.estimatedRows));
    console.log(`${B}${name}  ${rows}`);
  }
  console.log();
}
