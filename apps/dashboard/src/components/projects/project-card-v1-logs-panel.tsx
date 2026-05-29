"use client";

import { RefreshCw } from "lucide-react";

type Props = {
  logsOpen: boolean;
  logsService: "api" | "db";
  logsText: string;
  logsLoading: boolean;
  logsError: string | null;
  logSourceBtn: string;
  logSourceActive: string;
  logSourceIdle: string;
  onToggleOpen: () => void;
  onSetService: (service: "api" | "db") => void;
  onRefresh: () => void;
};

export function ProjectCardV1LogsPanel({
  logsOpen,
  logsService,
  logsText,
  logsLoading,
  logsError,
  logSourceBtn,
  logSourceActive,
  logSourceIdle,
  onToggleOpen,
  onSetService,
  onRefresh,
}: Props): React.ReactElement {
  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={logsOpen}
        className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        {logsOpen ? "Hide logs" : "Show logs"}
      </button>

      {logsOpen ? (
        <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Source</span>
            <div className="flex rounded-md border border-zinc-200 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-950">
              <button
                type="button"
                onClick={() => onSetService("api")}
                className={`${logSourceBtn} ${logsService === "api" ? logSourceActive : logSourceIdle}`}
              >
                PostgREST
              </button>
              <button
                type="button"
                onClick={() => onSetService("db")}
                className={`${logSourceBtn} ${logsService === "db" ? logSourceActive : logSourceIdle}`}
              >
                Postgres
              </button>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={logsLoading}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${logsLoading ? "animate-spin" : ""}`}
                aria-hidden
              />
              Refresh
            </button>
          </div>
          {logsError ? (
            <p className="border-b border-zinc-200 px-3 py-2 text-sm text-red-600 dark:border-zinc-800 dark:text-red-400">
              {logsError}
            </p>
          ) : null}
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all px-3 py-3 font-mono text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">
            {logsLoading && !logsText ? "Loading…" : logsText}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
