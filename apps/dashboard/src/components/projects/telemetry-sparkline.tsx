"use client";

import type { FluxProjectSummary } from "@flux/core/standalone";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type FleetTelemetryLevel,
  deriveTelemetryDisplay,
} from "@/src/lib/fleet-telemetry-display";
import {
  errorMessageFromJsonBody,
  readResponseJson,
} from "@/src/lib/fetch-json";

type HeartbeatEntry = {
  recordedAt: string;
  healthStatus: string;
};

type Props = {
  slug: string;
  pollMs?: number;
  createdAt: string;
  stackStatus: FluxProjectSummary["status"];
  healthStatus: string | null | undefined;
  lastHeartbeatAt: string | null | undefined;
};

function isSuccess(status: string): boolean {
  return status === "running";
}

export function TelemetrySparkline({
  slug,
  pollMs = 8000,
  createdAt,
  stackStatus,
  healthStatus,
  lastHeartbeatAt,
}: Props) {
  const [entries, setEntries] = useState<HeartbeatEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const meshLevel: FleetTelemetryLevel = useMemo(
    () =>
      deriveTelemetryDisplay({
        healthStatus,
        lastHeartbeatAt,
        createdAt,
        stackStatus,
      }),
    [healthStatus, lastHeartbeatAt, createdAt, stackStatus],
  );

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/history`,
        { cache: "no-store" },
      );
      const data: unknown = await readResponseJson(res, {
        apiLabel: "project history API",
      });
      if (!res.ok) {
        throw new Error(
          errorMessageFromJsonBody(
            data,
            `load failed (${String(res.status)})`,
          ),
        );
      }
      if (
        !data ||
        typeof data !== "object" ||
        !("entries" in data) ||
        !Array.isArray((data as { entries: unknown }).entries)
      ) {
        throw new Error("invalid history payload");
      }
      const list = (data as { entries: HeartbeatEntry[] }).entries
        .filter(
          (e) =>
            e &&
            typeof e.recordedAt === "string" &&
            typeof e.healthStatus === "string",
        )
        .reverse();
      setEntries([...list].slice(-20));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => {
      void load();
    }, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  const recent = entries ?? [];
  const healthyCount = recent.filter((e) => isSuccess(e.healthStatus)).length;
  const totalCount = recent.length;
  const latest = totalCount > 0 ? recent[totalCount - 1] : null;

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/20">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Status
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {err ? "Sync error" : fleetLabel(meshLevel)}
        </span>
      </div>
      {err ? (
        <p className="text-sm text-red-500">{err}</p>
      ) : null}
      <div className="grid gap-2 text-sm text-zinc-600 dark:text-zinc-300 sm:grid-cols-3">
        <div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Last checks</p>
          <p>{totalCount === 0 ? "No data yet" : `${healthyCount}/${totalCount} healthy`}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Latest probe</p>
          <p>{latest ? new Date(latest.recordedAt).toLocaleTimeString() : "Waiting"}</p>
        </div>
        <div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Project state</p>
          <p>{stackStatus === "running" ? "Online" : "Offline"}</p>
        </div>
      </div>
    </section>
  );
}

function fleetLabel(level: FleetTelemetryLevel): string {
  switch (level) {
    case "operational":
      return "Online";
    case "initializing":
      return "Starting";
    case "standby":
      return "Offline";
    case "offline":
      return "Error";
    default:
      return "Status";
  }
}
