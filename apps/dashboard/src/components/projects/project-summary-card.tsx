"use client";

import { Check, Clipboard, Loader2, Wrench } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { ProjectRow } from "@/src/components/projects/project-card";
import {
  deriveTelemetryDisplay,
  fleetTelemetryLabel,
} from "@/src/lib/fleet-telemetry-display";
import { projectApiInterface } from "@/src/lib/routing-identity";
import {
  errorMessageFromJsonBody,
  readResponseJson,
} from "@/src/lib/fetch-json";

type ServerStatus = ProjectRow["status"];

type DisplayStatus = ServerStatus | "transitioning";

function fleetStatusLabel(status: DisplayStatus): string {
  switch (status) {
    case "running":
      return "ACTIVE_RUNNING";
    case "stopped":
      return "STANDBY_HALTED";
    case "transitioning":
      return "POWER_TRANSITION";
    case "partial":
      return "SUBSYSTEM_PARTIAL";
    case "missing":
      return "STACK_MISSING";
    case "corrupted":
      return "CONFIG_DRIFT";
    default: {
      const _e: never = status;
      return _e;
    }
  }
}

function StatusTag({
  displayStatus,
  project,
}: {
  displayStatus: DisplayStatus;
  project: ProjectRow;
}) {
  const m = deriveTelemetryDisplay({
    healthStatus: project.healthStatus,
    lastHeartbeatAt: project.lastHeartbeatAt,
    createdAt: project.createdAt,
    stackStatus: project.status,
  });
  const dotClass =
    m === "operational"
      ? "bg-emerald-500"
      : m === "initializing"
        ? "bg-zinc-500"
        : m === "standby"
          ? "bg-zinc-600"
          : "bg-red-500";
  return (
    <span className="inline-flex max-w-[min(100%,16rem)] flex-col items-end gap-0.5">
      <span className="inline-flex items-center justify-end gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-200">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`}
          aria-hidden
        />
        <span className="text-right">{fleetTelemetryLabel(m)}</span>
      </span>
      <span className="text-right font-mono text-[9px] uppercase tracking-[0.1em] text-zinc-500">
        stack {fleetStatusLabel(displayStatus)}
      </span>
    </span>
  );
}

const easeOut = [0.22, 1, 0.36, 1] as const;

type Props = {
  project: ProjectRow;
  onOpenDetail: () => void;
  onRepaired?: () => void;
  onPowerChanged?: () => void;
  staggerIndex?: number;
};

export function ProjectSummaryCard({
  project: p,
  onOpenDetail,
  onRepaired,
  onPowerChanged,
  staggerIndex = 0,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [powerAction, setPowerAction] = useState<"start" | "stop" | null>(null);
  const [displayStatus, setDisplayStatus] = useState<DisplayStatus>(p.status);
  const [repairBusy, setRepairBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!busy && !repairBusy) {
      setDisplayStatus(p.status);
    }
  }, [p.status, busy, repairBusy]);

  const specHost = projectApiInterface(p.slug, p.hash);
  const raw = (p.apiUrl?.trim() || specHost).trim();
  const apiHref = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  async function copyApiUrl(): Promise<void> {
    try {
      await navigator.clipboard.writeText(apiHref);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* denied */
    }
  }

  async function runStart(): Promise<void> {
    if (busy) return;
    if (displayStatus !== "stopped") return;
    setBusy(true);
    setPowerAction("start");
    setActionError(null);
    setDisplayStatus("transitioning");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(p.slug)}/start`,
        { method: "POST" },
      );
      const data = (await readResponseJson(res, {
        apiLabel: "project start API",
      })) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(
          errorMessageFromJsonBody(
            data,
            `Start failed (${String(res.status)})`,
          ),
        );
      }
      setDisplayStatus("running");
      onPowerChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setDisplayStatus(p.status);
    } finally {
      setBusy(false);
      setPowerAction(null);
    }
  }

  async function runStop(): Promise<void> {
    if (busy) return;
    if (displayStatus !== "running") return;
    setBusy(true);
    setPowerAction("stop");
    setActionError(null);
    setDisplayStatus("transitioning");
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(p.slug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const data = (await readResponseJson(res, {
        apiLabel: "project stop API",
      })) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(
          errorMessageFromJsonBody(
            data,
            `Stop failed (${String(res.status)})`,
          ),
        );
      }
      setDisplayStatus("stopped");
      onPowerChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setDisplayStatus(p.status);
    } finally {
      setBusy(false);
      setPowerAction(null);
    }
  }

  async function runRepair(): Promise<void> {
    if (
      !window.confirm(
        "Repair removes Docker containers and volumes for this project, then provisions a new empty stack. All previous database data on the host is lost. Continue?",
      )
    ) {
      return;
    }
    setRepairBusy(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(p.slug)}/repair`,
        { method: "POST" },
      );
      const data = (await readResponseJson(res, {
        apiLabel: "project repair API",
      })) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(
          errorMessageFromJsonBody(
            data,
            `Repair failed (${String(res.status)})`,
          ),
        );
      }
      onRepaired?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setRepairBusy(false);
    }
  }

  const bladeBtn =
    "rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-300 transition-[opacity,color,border-color] duration-200 hover:border-zinc-500 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black";

  const startBladeBtn =
    "rounded-md border border-emerald-600/80 bg-zinc-900 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-400 transition-[opacity,color,border-color] duration-200 hover:border-emerald-500 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black";

  const bladeBtnDisabled =
    "disabled:cursor-not-allowed disabled:opacity-40";

  const showStartButton =
    displayStatus === "stopped" ||
    (displayStatus === "transitioning" && powerAction === "start");
  const showStopButton =
    displayStatus === "running" ||
    (displayStatus === "transitioning" && powerAction === "stop");

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.38,
        delay: staggerIndex * 0.06,
        ease: easeOut,
      }}
      className="group relative flex flex-col rounded-md border border-zinc-800 bg-black shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05),inset_0_0_100px_-24px_rgb(99_102_241/0.02)] transition-[border-color] duration-200 group-hover:border-zinc-600 group-focus-within:border-zinc-600"
      aria-label={`Project ${p.slug}`}
    >
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:p-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2
              className="font-sans text-lg font-bold tracking-tight text-white transition-[text-shadow] duration-200 group-hover:[text-shadow:0_0_28px_rgba(245,158,11,0.18)] sm:text-xl"
            >
              {p.slug}
            </h2>
            <span className="font-mono text-sm text-zinc-500">
              #{p.hash}
            </span>
          </div>

          <div className="mt-4 flex min-w-0 items-stretch gap-2 rounded-md border border-zinc-800/80 bg-zinc-900 px-3 py-2.5">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-300">
              {apiHref}
            </code>
            <button
              type="button"
              onClick={() => void copyApiUrl()}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Copy API URL"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
              ) : (
                <Clipboard className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
          </div>
        </div>

        <div className="flex shrink-0 justify-end sm:pt-0.5">
          <StatusTag displayStatus={displayStatus} project={p} />
        </div>
      </div>

      {actionError ? (
        <p
          className="border-t border-zinc-800/80 px-5 py-2 font-mono text-[10px] text-red-400 sm:px-6"
          role="alert"
        >
          {actionError}
        </p>
      ) : null}

      <div
        className="flex flex-wrap gap-2 border-t border-zinc-800/80 px-5 py-4 opacity-40 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 sm:px-6"
      >
        <button type="button" onClick={onOpenDetail} className={bladeBtn}>
          OPEN_CONSOLE
        </button>
        <button
          type="button"
          onClick={() => void runRepair()}
          disabled={repairBusy}
          className={`inline-flex items-center justify-center gap-2 ${bladeBtn} ${bladeBtnDisabled}`}
        >
          {repairBusy ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <Wrench className="h-3 w-3" aria-hidden />
          )}
          REPAIR
        </button>
        {showStartButton ? (
          <button
            type="button"
            onClick={() => void runStart()}
            disabled={busy && powerAction !== "start"}
            className={`${startBladeBtn} ${bladeBtnDisabled}`}
            aria-label="Start project"
          >
            {busy && powerAction === "start" ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                [ START ]
              </span>
            ) : (
              "[ START ]"
            )}
          </button>
        ) : null}
        {showStopButton ? (
          <button
            type="button"
            onClick={() => void runStop()}
            disabled={busy && powerAction !== "stop"}
            className={`${bladeBtn} ${bladeBtnDisabled}`}
            aria-label="Stop project"
          >
            {busy && powerAction === "stop" ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                [ STOP ]
              </span>
            ) : (
              "[ STOP ]"
            )}
          </button>
        ) : null}
      </div>

    </motion.article>
  );
}
