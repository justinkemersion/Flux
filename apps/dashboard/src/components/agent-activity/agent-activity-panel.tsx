"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  MCP_INTENT_STATUSES,
  MCP_RISK_LEVELS,
} from "@/src/lib/mcp-intents";
import { MCP_INTENT_CLASSES } from "@/src/lib/mcp-audit";
import {
  errorMessageFromJsonBody,
  readResponseJson,
} from "@/src/lib/fetch-json";
import type { AgentActivityIntent, AgentIntentsApiResponse } from "./agent-activity-types";
import {
  buildAgentIntentsQuery,
  filtersToSearchParams,
  formatAgentActivityTimestamp,
  parseAgentActivityFilters,
  riskBadgeClass,
  safeJsonPreview,
  statusBadgeClass,
} from "./agent-activity-utils";

const inputClass =
  "w-full min-w-0 rounded-md border border-zinc-700/80 bg-zinc-900/60 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500";

export function AgentActivityPanel() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => parseAgentActivityFilters(searchParams),
    [searchParams],
  );

  const [intents, setIntents] = useState<AgentActivityIntent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const userSegment =
    session?.user?.githubLogin?.trim() ||
    session?.user?.id?.trim() ||
    "—";

  const loadIntents = useCallback(
    async (opts: { cursor?: string; append?: boolean }) => {
      const isAppend = opts.append === true;
      if (isAppend) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const url = buildAgentIntentsQuery(filters, {
          limit: 50,
          ...(opts.cursor ? { cursor: opts.cursor } : {}),
        });
        const res = await fetch(url);
        const payload: unknown = await readResponseJson(res, {
          apiLabel: "agent intents API",
        });
        if (!res.ok) {
          throw new Error(
            errorMessageFromJsonBody(
              payload,
              `Request failed (${String(res.status)})`,
            ),
          );
        }
        if (
          !payload ||
          typeof payload !== "object" ||
          !("intents" in payload) ||
          !Array.isArray((payload as AgentIntentsApiResponse).intents)
        ) {
          throw new Error("Invalid response: expected intents array.");
        }
        const data = payload as AgentIntentsApiResponse;
        setIntents((prev) => (isAppend ? [...prev, ...data.intents] : data.intents));
        setNextCursor(data.nextCursor);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        if (!isAppend) setIntents([]);
      } finally {
        if (isAppend) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    if (sessionStatus === "unauthenticated") return;
    if (sessionStatus === "loading") return;
    void loadIntents({});
  }, [loadIntents, sessionStatus]);

  function applyFilters(next: typeof filters): void {
    const params = filtersToSearchParams(next);
    const qs = params.toString();
    router.replace(qs.length > 0 ? `${pathname}?${qs}` : pathname);
  }

  if (sessionStatus === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center py-24 text-zinc-500">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        <span className="sr-only">Loading session…</span>
      </div>
    );
  }

  if (sessionStatus === "unauthenticated") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-zinc-500">
        Sign in to view agent activity.
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-zinc-950 text-zinc-300">
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 lg:px-10">
        <nav
          className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500"
          aria-label="Breadcrumb"
        >
          <Link href="/projects" className="text-zinc-300 hover:text-zinc-100">
            Projects
          </Link>
          <span aria-hidden>/</span>
          <span className="truncate text-zinc-500" title={userSegment}>
            {userSegment}
          </span>
          <span aria-hidden>/</span>
          <span className="text-zinc-200">Agent Activity</span>
        </nav>

        <header className="mb-6">
          <h1 className="text-lg font-semibold text-zinc-100">Agent Activity</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            Read-only view of recent MCP agent intents. Sanitized summaries only — no raw SQL,
            paths, or credentials. Approval controls are not available here.
          </p>
        </header>

        <section
          className="mb-6 grid gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-4 sm:grid-cols-2 lg:grid-cols-5"
          aria-label="Filters"
        >
          <label className="block text-xs text-zinc-500">
            Project hash
            <input
              className={`${inputClass} mt-1 font-mono`}
              value={filters.projectHash}
              onChange={(e) => applyFilters({ ...filters, projectHash: e.target.value })}
              placeholder="abc1234"
              spellCheck={false}
            />
          </label>
          <label className="block text-xs text-zinc-500">
            Tool
            <input
              className={`${inputClass} mt-1`}
              value={filters.tool}
              onChange={(e) => applyFilters({ ...filters, tool: e.target.value })}
              placeholder="flux.migration.apply"
            />
          </label>
          <label className="block text-xs text-zinc-500">
            Status
            <select
              className={`${inputClass} mt-1`}
              value={filters.status}
              onChange={(e) => applyFilters({ ...filters, status: e.target.value })}
            >
              <option value="">All</option>
              {MCP_INTENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-zinc-500">
            Intent class
            <select
              className={`${inputClass} mt-1`}
              value={filters.intentClass}
              onChange={(e) => applyFilters({ ...filters, intentClass: e.target.value })}
            >
              <option value="">All</option>
              {MCP_INTENT_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-zinc-500">
            Risk level
            <select
              className={`${inputClass} mt-1`}
              value={filters.riskLevel}
              onChange={(e) => applyFilters({ ...filters, riskLevel: e.target.value })}
            >
              <option value="">All</option>
              {MCP_RISK_LEVELS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </section>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-zinc-500">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            Loading intents…
          </div>
        ) : error ? (
          <div
            className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-6 text-sm text-red-200"
            role="alert"
          >
            <p className="font-medium">Could not load agent activity</p>
            <p className="mt-1 text-red-300/90">{error}</p>
            <button
              type="button"
              onClick={() => void loadIntents({})}
              className="mt-4 rounded-md border border-red-800/60 px-3 py-1.5 text-xs text-red-100 hover:bg-red-950/40"
            >
              Retry
            </button>
          </div>
        ) : intents.length === 0 ? (
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/20 px-4 py-16 text-center text-sm text-zinc-500">
            <p className="font-medium text-zinc-400">No MCP intents yet</p>
            <p className="mt-2 max-w-md mx-auto">
              When agents run Flux MCP tools against your projects, sanitized intent records
              appear here. Try adjusting filters if you expected rows.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-zinc-800/80">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-zinc-800/80 bg-zinc-900/50 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">Time</th>
                    <th className="px-3 py-2.5 font-medium">Tool</th>
                    <th className="px-3 py-2.5 font-medium hidden sm:table-cell">Project</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium hidden md:table-cell">Class</th>
                    <th className="px-3 py-2.5 font-medium hidden lg:table-cell">Risk</th>
                    <th className="px-3 py-2.5 font-medium hidden xl:table-cell">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {intents.map((intent) => (
                    <Fragment key={intent.id}>
                      <tr className="align-top hover:bg-zinc-900/40">
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            className="text-left text-zinc-300 hover:text-zinc-100"
                            onClick={() =>
                              setExpandedId((id) => (id === intent.id ? null : intent.id))
                            }
                          >
                            <time dateTime={intent.createdAt}>
                              {formatAgentActivityTimestamp(intent.createdAt)}
                            </time>
                          </button>
                        </td>
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            className="text-left font-mono text-xs text-zinc-200 hover:text-white"
                            onClick={() =>
                              setExpandedId((id) => (id === intent.id ? null : intent.id))
                            }
                          >
                            {intent.tool}
                          </button>
                        </td>
                        <td className="hidden px-3 py-3 font-mono text-xs text-zinc-500 sm:table-cell">
                          {intent.projectHash ?? "—"}
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${statusBadgeClass(intent.status)}`}
                          >
                            {intent.status}
                          </span>
                        </td>
                        <td className="hidden px-3 py-3 text-xs text-zinc-400 md:table-cell">
                          {intent.intentClass}
                        </td>
                        <td
                          className={`hidden px-3 py-3 text-xs lg:table-cell ${riskBadgeClass(intent.riskLevel)}`}
                        >
                          {intent.riskLevel}
                        </td>
                        <td className="hidden px-3 py-3 text-xs text-zinc-500 xl:table-cell">
                          {intent.resultStatus ?? "—"}
                          {intent.errorCode ? ` · ${intent.errorCode}` : ""}
                        </td>
                      </tr>
                      {expandedId === intent.id ? (
                        <tr className="bg-zinc-900/30">
                          <td className="px-3 py-4" colSpan={7}>
                            <IntentDetail
                              intent={intent}
                              onClose={() => setExpandedId(null)}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {nextCursor ? (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadIntents({ cursor: nextCursor, append: true })}
                  className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Loading…
                    </>
                  ) : (
                    "Load more"
                  )}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function IntentDetail({
  intent,
  onClose,
}: {
  intent: AgentActivityIntent;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-sm text-zinc-100">{intent.tool}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {formatAgentActivityTimestamp(intent.createdAt)}
            {intent.updatedAt !== intent.createdAt
              ? ` · updated ${formatAgentActivityTimestamp(intent.updatedAt)}`
              : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
        >
          Close
        </button>
      </div>

      <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <DetailItem label="Project hash" value={intent.projectHash ?? "—"} mono />
        <DetailItem label="Intent class" value={intent.intentClass} />
        <DetailItem label="Status" value={intent.status} />
        <DetailItem label="Risk level" value={intent.riskLevel} />
        <DetailItem label="Policy" value={intent.policyDecision} />
        <DetailItem label="Result" value={intent.resultStatus ?? "—"} />
        <DetailItem label="Error code" value={intent.errorCode ?? "—"} />
        <DetailItem label="Plan ID" value={intent.planId ?? "—"} mono />
        <DetailItem
          label="Plan hash"
          value={intent.planHash ? `${intent.planHash.slice(0, 16)}…` : "—"}
          mono
        />
        <DetailItem label="Approval" value={intent.approvalStatus ?? "—"} />
      </dl>

      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Safe summary
        </h3>
        <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-zinc-800 bg-zinc-950/80 p-3 font-mono text-[11px] text-zinc-400">
          {safeJsonPreview(intent.summary)}
        </pre>
      </div>

      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Safe metadata
        </h3>
        <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-zinc-800 bg-zinc-950/80 p-3 font-mono text-[11px] text-zinc-400">
          {safeJsonPreview(intent.metadata)}
        </pre>
      </div>
    </div>
  );
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-zinc-600">{label}</dt>
      <dd className={`mt-0.5 text-zinc-300 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
