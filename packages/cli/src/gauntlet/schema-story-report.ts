import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  SchemaGraph,
  SchemaInspectionResult,
  SchemaWarning,
} from "@flux/core/schema-inspection";

export function buildSchemaGraph(
  result: Pick<SchemaInspectionResult, "tables" | "relationships">,
): SchemaGraph {
  const nodes = result.tables.map((table) => ({
    id: table.name,
    label: table.name,
  }));

  const edges = result.relationships.map((rel) => ({
    from: rel.fromTable,
    to: rel.toTable,
    label: rel.fromColumns.join(", "),
    constraintName: rel.constraintName,
  }));

  return { nodes, edges };
}

export function formatSchemaInspectionStageSummary(
  result: SchemaInspectionResult,
): string {
  const parts = [
    `${String(result.summary.tableCount)} table(s)`,
    `${String(result.summary.columnCount)} column(s)`,
    `${String(result.summary.relationshipCount)} relationship(s)`,
  ];
  if (result.warnings.length > 0) {
    parts.push(`${String(result.warnings.length)} warning(s)`);
  }
  return parts.join(", ");
}

function formatWarningLine(w: SchemaWarning): string {
  const where = w.table
    ? w.column
      ? ` on ${w.table}.${w.column}`
      : ` on ${w.table}`
    : "";
  return `- ${w.severity}: ${w.code}${where} — ${w.message}`;
}

export function buildSchemaInspectionMarkdownSection(
  result: SchemaInspectionResult,
): string {
  const lines: string[] = [];
  lines.push("## Schema Inspection");
  lines.push("");
  lines.push(`Tables: ${String(result.summary.tableCount)}`);
  lines.push(`Columns: ${String(result.summary.columnCount)}`);
  lines.push(`Relationships: ${String(result.summary.relationshipCount)}`);
  lines.push(`RLS enabled: ${String(result.summary.tablesWithRlsEnabled)}`);
  lines.push(`RLS disabled: ${String(result.summary.tablesWithRlsDisabled)}`);
  lines.push("");

  if (result.warnings.length > 0) {
    lines.push("Warnings:");
    for (const w of result.warnings) {
      lines.push(formatWarningLine(w));
    }
    lines.push("");
  } else {
    lines.push("Warnings: none");
    lines.push("");
  }

  return lines.join("\n");
}

export async function writeSchemaInspectionArtifacts(input: {
  reportDir: string;
  result: SchemaInspectionResult;
}): Promise<void> {
  await mkdir(input.reportDir, { recursive: true });
  const graph = buildSchemaGraph(input.result);

  await writeFile(
    join(input.reportDir, "schema-inspection.json"),
    `${JSON.stringify(input.result, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(input.reportDir, "schema-graph.json"),
    `${JSON.stringify(graph, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(input.reportDir, "schema-warnings.json"),
    `${JSON.stringify(input.result.warnings, null, 2)}\n`,
    "utf8",
  );
}

export function injectSchemaInspectionMarkdown(
  reportMarkdown: string,
  result: SchemaInspectionResult,
): string {
  const section = buildSchemaInspectionMarkdownSection(result);
  const marker = "## Cleanup";
  const idx = reportMarkdown.indexOf(marker);
  if (idx === -1) {
    return `${reportMarkdown.trimEnd()}\n\n${section}`;
  }
  return `${reportMarkdown.slice(0, idx)}${section}${reportMarkdown.slice(idx)}`;
}
