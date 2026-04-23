"use client";

import { Loader2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type ReactElement,
} from "react";
import {
  errorMessageFromJsonBody,
  readResponseJson,
} from "@/src/lib/fetch-json";

type OverviewHealth = "running" | "degraded" | "error";

type OverviewPayload = {
  node: {
    containerCount: number;
    memoryUsage: number;
    cpuLoad: number;
  };
  summary: { running: number; degraded: number; error: number };
  projects: { slug: string; name: string; health: OverviewHealth }[];
};

function healthDotClass(h: OverviewHealth): string {
  switch (h) {
    case "running":
      return "bg-emerald-500";
    case "degraded":
      return "bg-amber-500";
    case "error":
      return "bg-red-500";
  }
}

const POLL_MS = 8_000;

/**
 * Server-rack style overview: per-project health dots + host telemetry sidebar.
 */
export function FleetHealthGrid(): ReactElement {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch("/api/fleet/overview", { cache: "no-store" });
      const body: unknown = await readResponseJson(res, {
        apiLabel: "fleet overview API",
      });
      if (!res.ok) {
        throw new Error(
          errorMessageFromJsonBody(
            body,
            `Overview failed (${String(res.status)})`,
          ),
        );
      }
      setData(body as OverviewPayload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !data) {
    return (
      <div
        className="mb-6 flex min-h-[88px] border border-zinc-800 bg-zinc-950 font-mono items-center justify-center"
        role="status"
        aria-label="Control room loading"
      >
        <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
      </div>
    );
  }

  if (err && !data) {
    return (
      <div
        className="mb-6 border border-red-900/50 bg-zinc-950/80 p-2 font-mono text-[10px] text-red-400"
        role="alert"
      >
        CONTROL_ROOM_FAULT: {err}
      </div>
    );
  }

  const d = data!;
  return (
    <div className="mb-6 flex min-h-[88px] w-full min-w-0 border border-zinc-800 bg-zinc-950/90 font-mono text-[10px] text-zinc-500">
      <div className="min-w-0 flex-1 border-r border-zinc-800 p-2">
        <div className="mb-1.5 flex items-baseline justify-between gap-2 uppercase tracking-[0.2em] text-zinc-600">
          <span>CONTROL_ROOM / FLEET</span>
          {err ? (
            <span className="text-amber-500" title={err}>
              STALE
            </span>
          ) : null}
        </div>
        {d.projects.length === 0 ? (
          <p className="pt-1 text-zinc-600">NO_TENANT_PROJECTS</p>
        ) : (
          <div
            className="flex max-h-24 flex-wrap content-start gap-x-0.5 gap-y-0.5 overflow-y-auto pl-0.5"
            aria-label="Per-project health cells"
            title="Project health: green=running, amber=degraded, red=error"
          >
            {d.projects.map((p) => (
              <span
                key={p.slug}
                className={`h-2 w-2 shrink-0 border border-zinc-800/80 ${healthDotClass(p.health)}`}
                title={`${p.name} (${p.slug}): ${p.health}`}
              />
            ))}
          </div>
        )}
        {d.summary ? (
          <div className="mt-2 border-t border-zinc-800/80 pt-1.5 text-[9px] uppercase text-zinc-600">
            RUN: {d.summary.running} DEG: {d.summary.degraded} ERR:{" "}
            {d.summary.error}
          </div>
        ) : null}
      </div>
      <aside
        className="w-44 shrink-0 p-2 uppercase tracking-wider"
        aria-label="Node status"
      >
        <p className="mb-1.5 border-b border-zinc-800 pb-1 text-zinc-600">
          NODE
        </p>
        <dl className="space-y-0.5 text-left normal-case">
          <div className="flex justify-between gap-2 text-zinc-500">
            <dt className="shrink-0">RAM</dt>
            <dd className="text-right text-zinc-300">
              {d.node.memoryUsage.toFixed(1)}%
            </dd>
          </div>
          <div className="flex justify-between gap-2 text-zinc-500">
            <dt className="shrink-0">LD1M</dt>
            <dd className="text-right text-zinc-300">
              {d.node.cpuLoad.toFixed(2)}
            </dd>
          </div>
          <div className="flex justify-between gap-2 text-zinc-500">
            <dt className="shrink-0">CTRS</dt>
            <dd className="text-right text-zinc-300">
              {d.node.containerCount}
            </dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
