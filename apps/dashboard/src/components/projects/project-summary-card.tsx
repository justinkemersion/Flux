"use client";

import { Check, Clipboard, Loader2, Wrench } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { formatPortfolioLastActivity } from "@flux/core/project-portfolio";
import { EngineModeBadge } from "@/src/components/projects/engine-mode-badge";
import { ProjectLifecycleBadge } from "@/src/components/projects/project-lifecycle-badge";
import { ProjectBackupStatusCard } from "@/src/components/projects/project-backup-status-card";
import type { ProjectRow } from "@/src/components/projects/project-types";
import {
  deriveTelemetryDisplay,
  fleetTelemetryMeshSubLabel,
} from "@/src/lib/fleet-telemetry-display";
import { projectApiInterface } from "@/src/lib/routing-identity";
import {
  errorMessageFromJsonBody,
  readResponseJson,
} from "@/src/lib/fetch-json";
import { useProjectBackupTrust } from "@/src/lib/project-backup-trust-client";

type ServerStatus = ProjectRow["status"];

type DisplayStatus = ServerStatus | "transitioning";

const easeOut = [0.22, 1, 0.36, 1] as const;

type Props = {
  project: ProjectRow;
  onOpenDetail: () => void;
  onRepaired?: () => void;
  onPowerChanged?: () => void;
  staggerIndex?: number;
};

function runtimeHint(project: ProjectRow): string | null {
  const lifecycle = project.lifecycleState ?? "active";
  if (lifecycle === "dormant") {
    return "Asleep — data retained; wake to resume API traffic.";
  }
  if (lifecycle === "archived") {
    return "Archived — wake when you need traffic again.";
  }
  const level = deriveTelemetryDisplay({
    healthStatus: project.healthStatus,
    lastHeartbeatAt: project.lastHeartbeatAt,
    createdAt: project.createdAt,
    stackStatus: project.status,
    lifecycleState: lifecycle,
  });
  if (level === "operational") return null;
  return fleetTelemetryMeshSubLabel(level);
}

export function ProjectSummaryCard({
  project: p,
  onOpenDetail,
  onRepaired,
  onPowerChanged,
  staggerIndex = 0,
}: Props) {
  const isV2Shared = p.mode === "v2_shared";
  const projectMode = isV2Shared ? "v2_shared" : "v1_dedicated";
  const lifecycle = p.lifecycleState ?? "active";
  const backupTrustState = useProjectBackupTrust(p.hash);
  const [copied, setCopied] = useState(false);
  const [wakeBusy, setWakeBusy] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [displayStatus, setDisplayStatus] = useState<DisplayStatus>(p.status);

  useEffect(() => {
    if (!wakeBusy && !repairBusy) {
      setDisplayStatus(p.status);
    }
  }, [p.status, wakeBusy, repairBusy]);

  const specHost = projectApiInterface(
    p.slug,
    p.hash,
    isV2Shared ? "v2_shared" : "v1_dedicated",
  );
  const raw = (p.apiUrl?.trim() || specHost).trim();
  const apiHref = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  const purposeLine = p.description?.trim() || null;
  const activityLine = formatPortfolioLastActivity(p.lastActivityAt ?? null);
  const runtimeLine = runtimeHint(p);

  async function copyApiUrl(): Promise<void> {
    try {
      await navigator.clipboard.writeText(apiHref);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* denied */
    }
  }

  async function runWake(): Promise<void> {
    if (wakeBusy) return;
    setWakeBusy(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(p.slug)}/lifecycle?hash=${encodeURIComponent(p.hash)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "wake" }),
        },
      );
      const data = (await readResponseJson(res, {
        apiLabel: "project lifecycle API",
      })) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(
          errorMessageFromJsonBody(
            data,
            `Wake failed (${String(res.status)})`,
          ),
        );
      }
      onPowerChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setWakeBusy(false);
    }
  }

  async function runRepair(): Promise<void> {
    const confirmMsg = isV2Shared
      ? "Repair re-runs shared-cluster provisioning for this tenant. Continue?"
      : "Repair reconciles this project's Docker stack in place (restarts/adopts/recreates missing services) without deleting Postgres data. Continue?";
    if (!window.confirm(confirmMsg)) {
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

  const actionBtn =
    "inline-flex h-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/40 disabled:cursor-not-allowed disabled:opacity-40";
  const primaryBtn =
    "inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/40 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-100 dark:text-zinc-900";

  const showWake = lifecycle === "dormant" || lifecycle === "archived";
  const showRepair =
    displayStatus === "missing" ||
    displayStatus === "corrupted" ||
    (isV2Shared &&
      (p.healthStatus === "error" || p.healthStatus === "incomplete"));

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.38,
        delay: staggerIndex * 0.06,
        ease: easeOut,
      }}
      className="group relative flex flex-col rounded-md border border-zinc-800 bg-black shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05),inset_0_0_100px_-24px_rgb(99_102_241/0.02)] transition-[border-color] duration-200 hover:border-zinc-600 focus-within:border-zinc-600"
      aria-label={`Project ${p.slug}`}
    >
      <div className="flex flex-col gap-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-geist-sans truncate text-xl font-medium tracking-tight text-white sm:text-2xl">
                {p.name}
              </h2>
              <ProjectLifecycleBadge state={lifecycle} />
            </div>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">
              {purposeLine ?? (
                <span className="font-mono text-zinc-500">{p.slug}</span>
              )}
            </p>
          </div>
          <EngineModeBadge mode={p.mode} surface="darkCard" />
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <ProjectBackupStatusCard
            slug={p.slug}
            mode={projectMode}
            backups={backupTrustState.backups}
            trust={backupTrustState.trust}
            loading={backupTrustState.loading}
            error={backupTrustState.error}
            onRefresh={() => void backupTrustState.refresh()}
            variant="inline"
          />
          {activityLine ? (
            <>
              <span className="text-zinc-700" aria-hidden>
                ·
              </span>
              <span>{activityLine}</span>
            </>
          ) : null}
        </div>

        {runtimeLine ? (
          <p className="text-xs text-zinc-500">{runtimeLine}</p>
        ) : null}
      </div>

      {actionError ? (
        <p
          className="border-t border-zinc-800/80 px-5 py-2 font-mono text-[10px] text-red-400 sm:px-6"
          role="alert"
        >
          {actionError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-zinc-800/80 px-5 py-4 sm:px-6">
        <button type="button" onClick={onOpenDetail} className={primaryBtn}>
          Open
        </button>
        {showWake ? (
          <button
            type="button"
            onClick={() => void runWake()}
            disabled={wakeBusy}
            className={actionBtn}
          >
            {wakeBusy ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Waking…
              </span>
            ) : (
              "Wake project"
            )}
          </button>
        ) : null}
        {showRepair ? (
          <button
            type="button"
            onClick={() => void runRepair()}
            disabled={repairBusy}
            className={`inline-flex items-center gap-2 ${actionBtn}`}
          >
            {repairBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Wrench className="h-3 w-3" aria-hidden />
            )}
            Repair
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void copyApiUrl()}
          className={actionBtn}
          aria-label="Copy API URL"
        >
          {copied ? (
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
              Copied
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Clipboard className="h-3.5 w-3.5" aria-hidden />
              Copy API URL
            </span>
          )}
        </button>
      </div>
    </motion.article>
  );
}
