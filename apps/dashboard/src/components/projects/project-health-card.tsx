"use client";

import { ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";

type DoctorCheckStatus = "pass" | "warn" | "fail";

type DoctorCheck = {
  name: string;
  status: DoctorCheckStatus;
  detail: string;
  remediation?: string;
};

type DoctorReport = {
  projectSlug: string;
  hash: string;
  mode: string;
  schema: string;
  checks: DoctorCheck[];
  overallStatus: DoctorCheckStatus;
  generatedAt: string;
};

type Props = {
  slug: string;
  hash: string;
};

function StatusDot({ status }: { status: DoctorCheckStatus }) {
  const cls =
    status === "pass"
      ? "bg-emerald-500"
      : status === "warn"
        ? "bg-amber-400"
        : "bg-red-500";
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`}
      aria-hidden
    />
  );
}

function overallLabel(status: DoctorCheckStatus): string {
  if (status === "pass") return "Healthy";
  if (status === "warn") return "Warnings";
  return "Degraded";
}

function overallClass(status: DoctorCheckStatus): string {
  if (status === "pass")
    return "text-emerald-700 dark:text-emerald-400";
  if (status === "warn")
    return "text-amber-700 dark:text-amber-300";
  return "text-red-700 dark:text-red-400";
}

/**
 * Collapsible health card for the project mesh readout.
 * Runs the doctor check on expand (lazy — avoids extra API calls on load).
 */
export function ProjectHealthCard({ slug, hash }: Props) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(): void {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (report) return; // already loaded
    setLoading(true);
    setError(null);
    fetch(
      `/api/projects/${encodeURIComponent(slug)}/doctor?hash=${encodeURIComponent(hash)}`,
    )
      .then(async (res) => {
        const body = (await res.json()) as DoctorReport | { error?: string };
        if (!res.ok) {
          setError((body as { error?: string }).error ?? `Request failed (${String(res.status)})`);
          return;
        }
        setReport(body as DoctorReport);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Doctor check failed.");
      })
      .finally(() => setLoading(false));
  }

  return (
    <section
      className="rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/40"
      aria-label="Project health"
    >
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Health
          </span>
          {report ? (
            <span className={`text-xs font-medium ${overallClass(report.overallStatus)}`}>
              {overallLabel(report.overallStatus)}
            </span>
          ) : null}
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="border-t border-zinc-100 px-4 pb-4 pt-3 dark:border-zinc-800/60">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Running checks…
            </div>
          ) : error ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : report ? (
            <div>
              <ul className="space-y-1.5">
                {report.checks.map((check, i) => (
                  <li key={i} className="text-xs">
                    <div className="flex items-start gap-2">
                      <StatusDot status={check.status} />
                      <span>
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">
                          {check.name}
                        </span>
                        <span className="ml-1.5 text-zinc-500 dark:text-zinc-400">
                          {check.detail}
                        </span>
                      </span>
                    </div>
                    {check.remediation && check.status !== "pass" ? (
                      <p className="ml-4 mt-0.5 text-zinc-400 dark:text-zinc-500">
                        → {check.remediation}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[10px] text-zinc-400 dark:text-zinc-600">
                Checked {new Date(report.generatedAt).toLocaleTimeString()}
                {" · "}
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() => {
                    setReport(null);
                    setLoading(true);
                    setError(null);
                    fetch(
                      `/api/projects/${encodeURIComponent(slug)}/doctor?hash=${encodeURIComponent(hash)}`,
                    )
                      .then(async (res) => {
                        const body = (await res.json()) as DoctorReport | { error?: string };
                        if (!res.ok) {
                          setError((body as { error?: string }).error ?? "Request failed");
                          return;
                        }
                        setReport(body as DoctorReport);
                      })
                      .catch((err: unknown) => {
                        setError(err instanceof Error ? err.message : "Failed");
                      })
                      .finally(() => setLoading(false));
                  }}
                >
                  Re-check
                </button>
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
