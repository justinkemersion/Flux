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

/**
 * High-density block strip: emerald = probe OK, red = failure, dim zinc voids = pending (initializing).
 */
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

  const slotCount = 20;
  const blocks = entries
    ? entries.map((e, i) => ({
        key: `${e.recordedAt}-${i}`,
        ok: isSuccess(e.healthStatus),
      }))
    : [];
  const pad = Math.max(0, slotCount - blocks.length);
  const pendingPad =
    meshLevel === "initializing" && blocks.length === 0 && !err;

  return (
    <div className="border border-zinc-800 bg-zinc-950/80 p-3">
      <div className="mb-2 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
        <span>MESH_TELEMETRY</span>
        <span className="text-zinc-600">
          {err
            ? "SYNC_ERR"
            : pendingPad
              ? "PENDING_FIRST_PROBE"
              : `${String(blocks.length)}/${String(slotCount)}`}
        </span>
      </div>
      {err ? (
        <p className="font-mono text-xs text-red-400">{err}</p>
      ) : null}
      <div
        className="grid gap-px border border-zinc-800/80 bg-zinc-800"
        style={{
          gridTemplateColumns: `repeat(${String(slotCount)}, minmax(0, 1fr))`,
        }}
        aria-label="Last twenty mesh probes, oldest to newest"
      >
        {Array.from({ length: pad }, (_, i) => (
          <div
            key={`void-${i}`}
            className={`h-3 ${
              pendingPad ? "bg-zinc-700/50" : "bg-zinc-900"
            }`}
            title={pendingPad ? "Pending" : "—"}
          />
        ))}
        {blocks.map((b) => (
          <div
            key={b.key}
            className={`h-3 ${b.ok ? "bg-emerald-500" : "bg-red-500"}`}
            title={b.ok ? "NOMINAL" : "FAULT"}
          />
        ))}
      </div>
    </div>
  );
}
