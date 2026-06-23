"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type AppliedMigration = {
  version: string;
  filename: string;
  checksum: string;
  appliedAt?: string;
};

type Props = {
  slug: string;
  hash: string;
};

function formatAppliedAt(iso: string | undefined): string {
  if (!iso?.trim()) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ProjectMigrationsPanel({ slug, hash }: Props) {
  const [applied, setApplied] = useState<AppliedMigration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/migrations?hash=${encodeURIComponent(hash)}`,
      );
      const body = (await res.json()) as {
        applied?: AppliedMigration[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `Request failed (${String(res.status)})`);
      }
      setApplied(Array.isArray(body.applied) ? body.applied : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load migrations.");
    } finally {
      setLoading(false);
    }
  }, [hash, slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sorted = [...applied].sort((a, b) => a.version.localeCompare(b.version));

  return (
    <section
      className="rounded-md border border-zinc-200/70 bg-white/60 p-4 dark:border-zinc-800/60 dark:bg-zinc-950/30"
      aria-label="SQL migrations ledger"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Migrations
          </h4>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">
            Applied rows from <code className="font-mono">flux.flux_migrations</code>.
            Pending preview runs locally via{" "}
            <code className="font-mono">flux push migrations/ --plan</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="text-xs font-medium text-zinc-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-zinc-400"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading ledger…
        </div>
      ) : error ? (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
              Applied
            </p>
            {sorted.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                No migrations recorded yet.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {sorted.map((row) => (
                  <li
                    key={`${row.version}-${row.checksum}`}
                    className="rounded border border-zinc-200/60 px-2.5 py-2 text-xs dark:border-zinc-800/60"
                  >
                    <div className="font-mono text-zinc-800 dark:text-zinc-200">
                      {row.filename || row.version}
                    </div>
                    <div className="mt-0.5 text-zinc-500 dark:text-zinc-500">
                      Applied {formatAppliedAt(row.appliedAt)}
                      {" · "}
                      checksum {row.checksum.slice(0, 12)}…
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
              Pending / warnings
            </p>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Run{" "}
              <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[11px] dark:bg-zinc-900">
                flux push migrations/ --plan
              </code>{" "}
              from your repo to preview pending files, table-level DDL hints, and
              DROP warnings before applying.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
