"use client";

import type {
  InspectedTable,
  SchemaInspectionResult,
  SchemaWarning,
} from "@flux/core/schema-inspection-types";
import { ChevronLeft, ClipboardCopy, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

const PREVIEW_ROW_LIMIT = 50;

type Props = {
  slug: string;
  hash: string;
};

type RowPreviewResult = {
  tableName: string;
  schema: string;
  columns: string[];
  rows: Record<string, unknown>[];
};

type DetailTab = "schema" | "rows";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function fmtRows(n: number | undefined): string {
  if (n === undefined || n < 0) return "—";
  return `~${String(n)}`;
}

function truncate(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function cellDisplay(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return truncate(JSON.stringify(v));
  return truncate(String(v));
}

function RlsBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span className="inline-flex items-center rounded-sm border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
      RLS on
    </span>
  ) : (
    <span className="inline-flex items-center rounded-sm border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
      RLS off
    </span>
  );
}

function WarningRow({ w }: { w: SchemaWarning }) {
  const color =
    w.severity === "danger"
      ? "text-red-700 dark:text-red-400"
      : w.severity === "warning"
        ? "text-amber-700 dark:text-amber-400"
        : "text-zinc-500 dark:text-zinc-400";
  return (
    <li className={`text-xs leading-snug ${color}`}>
      {w.message}
      {w.table ? (
        <span className="ml-1 font-mono text-zinc-500 dark:text-zinc-500">
          ({w.table})
        </span>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Row preview
// ---------------------------------------------------------------------------

function RowsView({
  slug,
  hash,
  table,
}: {
  slug: string;
  hash: string;
  table: InspectedTable;
}) {
  const [data, setData] = useState<RowPreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(
      `/api/projects/${encodeURIComponent(slug)}/tables/${encodeURIComponent(table.name)}/rows?hash=${encodeURIComponent(hash)}`,
    )
      .then(async (res) => {
        if (cancelled) return;
        const body = (await res.json()) as RowPreviewResult | { error?: string };
        if (!res.ok) {
          setError((body as { error?: string }).error ?? `Request failed (${String(res.status)})`);
          return;
        }
        setData(body as RowPreviewResult);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load rows.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, hash, table.name]);

  function copyRow(index: number, row: Record<string, unknown>): void {
    void navigator.clipboard.writeText(JSON.stringify(row, null, 2)).then(() => {
      setCopied(index);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-zinc-500 dark:text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading rows…
      </div>
    );
  }

  if (error) {
    return (
      <p className="py-2 text-sm text-red-600 dark:text-red-400" role="alert">
        {error}
      </p>
    );
  }

  if (!data) return null;

  if (data.rows.length === 0) {
    return (
      <p className="py-4 text-sm text-zinc-500 dark:text-zinc-400">
        No rows in <span className="font-mono">{table.name}</span>.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-2 text-xs text-zinc-400 dark:text-zinc-500">
        Showing up to {String(PREVIEW_ROW_LIMIT)} rows ·{" "}
        {String(data.rows.length)} returned
      </p>
      <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
              {data.columns.map((col) => (
                <th
                  key={col}
                  className="whitespace-nowrap px-3 py-2 text-left font-mono font-medium text-zinc-500 dark:text-zinc-400"
                >
                  {col}
                </th>
              ))}
              <th className="px-2 py-2" aria-label="Copy row JSON" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {data.rows.map((row, i) => (
              <tr
                key={i}
                className="group hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
              >
                {data.columns.map((col) => (
                  <td
                    key={col}
                    className="max-w-[18rem] truncate whitespace-nowrap px-3 py-1.5 font-mono text-zinc-700 dark:text-zinc-300"
                    title={row[col] != null ? String(row[col]) : ""}
                  >
                    {row[col] == null ? (
                      <span className="text-zinc-300 dark:text-zinc-600">
                        null
                      </span>
                    ) : (
                      cellDisplay(row[col])
                    )}
                  </td>
                ))}
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => copyRow(i, row)}
                    className="invisible text-zinc-400 transition-colors hover:text-zinc-700 group-hover:visible dark:text-zinc-500 dark:hover:text-zinc-200"
                    aria-label="Copy row as JSON"
                    title="Copy row as JSON"
                  >
                    <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
                    {copied === i ? (
                      <span className="sr-only">Copied</span>
                    ) : null}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table detail (Schema + Rows tabs)
// ---------------------------------------------------------------------------

function TableDetail({
  slug,
  hash,
  table,
  onBack,
}: {
  slug: string;
  hash: string;
  table: InspectedTable;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>("schema");

  const tabClass = (t: DetailTab) =>
    `px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
      tab === t
        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
        : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
    }`;

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Tables
      </button>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h4 className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {table.name}
        </h4>
        <RlsBadge enabled={table.rls.enabled} />
        <span className="text-xs text-zinc-400 dark:text-zinc-500">
          {String(table.columns.length)} columns · {fmtRows(table.estimatedRows)} rows
        </span>
      </div>

      {/* Tab toggle */}
      <div className="mb-4 flex gap-1">
        <button
          type="button"
          className={tabClass("schema")}
          onClick={() => setTab("schema")}
        >
          Schema
        </button>
        <button
          type="button"
          className={tabClass("rows")}
          onClick={() => setTab("rows")}
        >
          Rows
        </button>
      </div>

      {tab === "schema" ? (
        <div>
          {/* Columns */}
          <div className="mb-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              Columns
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-100 text-left dark:border-zinc-800">
                  <th className="pb-1.5 pr-4 font-medium text-zinc-500 dark:text-zinc-400">
                    Name
                  </th>
                  <th className="pb-1.5 pr-4 font-medium text-zinc-500 dark:text-zinc-400">
                    Type
                  </th>
                  <th className="pb-1.5 font-medium text-zinc-500 dark:text-zinc-400">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {table.columns.map((col) => {
                  const pk = table.primaryKey.includes(col.name);
                  const fk = col.isForeignKey;
                  return (
                    <tr key={col.name}>
                      <td className="py-1.5 pr-4 font-mono text-zinc-800 dark:text-zinc-200">
                        {col.name}
                      </td>
                      <td className="py-1.5 pr-4 font-mono text-zinc-500 dark:text-zinc-400">
                        {col.type}
                      </td>
                      <td className="py-1.5">
                        <span className="flex flex-wrap gap-1">
                          {pk ? (
                            <span className="rounded-sm bg-zinc-100 px-1 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                              PK
                            </span>
                          ) : null}
                          {fk ? (
                            <span className="rounded-sm bg-zinc-100 px-1 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                              FK
                            </span>
                          ) : null}
                          {col.nullable ? (
                            <span className="text-zinc-400 dark:text-zinc-500">
                              nullable
                            </span>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Foreign keys */}
          {table.foreignKeys.length > 0 ? (
            <div className="mb-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Relationships
              </p>
              <ul className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                {table.foreignKeys.map((fk) => (
                  <li key={fk.constraintName} className="font-mono">
                    {fk.columns.join(", ")}
                    <span className="mx-1.5 text-zinc-400">→</span>
                    {fk.referencedTable}.{fk.referencedColumns.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* RLS */}
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-medium">Security:</span>
            <RlsBadge enabled={table.rls.enabled} />
          </div>
        </div>
      ) : (
        <RowsView
          key={`${slug}-${hash}-${table.name}`}
          slug={slug}
          hash={hash}
          table={table}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table list
// ---------------------------------------------------------------------------

function TableList({
  result,
  onSelect,
}: {
  result: SchemaInspectionResult;
  onSelect: (t: InspectedTable) => void;
}) {
  const { tables, warnings, project, summary } = result;

  if (tables.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
        <p className="font-medium">No tables found</p>
        <p className="mt-1 text-xs">
          Schema <span className="font-mono">{project.schema}</span> has no
          user tables. Run migrations to create tables.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3">
        <span className="text-xs text-zinc-400 dark:text-zinc-500">
          {String(summary.tableCount)} tables · schema{" "}
          <span className="font-mono">{project.schema}</span>
        </span>
      </div>

      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
        {tables.map((t) => (
          <li key={t.name}>
            <button
              type="button"
              onClick={() => onSelect(t)}
              className="flex w-full items-center justify-between gap-3 px-0 py-2.5 text-left transition-colors hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              <span className="min-w-0">
                <span className="block font-mono text-sm text-zinc-800 dark:text-zinc-200">
                  {t.name}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-400 dark:text-zinc-500">
                  {String(t.columns.length)} columns · {fmtRows(t.estimatedRows)} rows
                </span>
              </span>
              <RlsBadge enabled={t.rls.enabled} />
            </button>
          </li>
        ))}
      </ul>

      {warnings.length > 0 ? (
        <div className="mt-4 rounded-md border border-zinc-200/60 bg-zinc-50/60 p-3 dark:border-zinc-800/60 dark:bg-zinc-900/30">
          <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Schema notes
          </p>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <WarningRow key={i} w={w} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

/**
 * Read-only schema and data explorer for the Database tools modal.
 *
 * This is a project-owner/admin inspection view backed by v1 Docker exec or
 * v2 shared admin credentials — it is NOT a simulation of what an app user
 * sees through PostgREST + RLS.
 */
export function ProjectSchemaExplorer({ slug, hash }: Props) {
  return <ProjectSchemaExplorerInner key={`${slug}-${hash}`} slug={slug} hash={hash} />;
}

function ProjectSchemaExplorerInner({ slug, hash }: Props) {
  const [result, setResult] = useState<SchemaInspectionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<InspectedTable | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    fetch(
      `/api/projects/${encodeURIComponent(slug)}/schema?hash=${encodeURIComponent(hash)}`,
    )
      .then(async (res) => {
        if (cancelled) return;
        const body = (await res.json()) as
          | SchemaInspectionResult
          | { error?: string };
        if (!res.ok) {
          setError(
            (body as { error?: string }).error ??
              `Request failed (${String(res.status)})`,
          );
          return;
        }
        setResult(body as SchemaInspectionResult);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load schema.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, hash]);

  return (
    <div>
      <p className="mb-3 text-xs text-zinc-400 dark:text-zinc-500">
        Project-owner inspection view — not a PostgREST / RLS simulation.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-zinc-500 dark:text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading schema…
        </div>
      ) : error ? (
        <p
          className="py-2 text-sm text-red-600 dark:text-red-400"
          role="alert"
        >
          {error}
        </p>
      ) : result ? (
        selectedTable ? (
          <TableDetail
            slug={slug}
            hash={hash}
            table={selectedTable}
            onBack={() => setSelectedTable(null)}
          />
        ) : (
          <TableList result={result} onSelect={setSelectedTable} />
        )
      ) : null}
    </div>
  );
}
