"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { MeshTelemetryPill } from "@/src/components/mesh-telemetry-pill";
import type { ProjectRow } from "@/src/components/projects/project-types";
import { ProjectHeader } from "@/src/components/projects/project-header";
import { ProjectMeshReadout } from "@/src/components/projects/project-mesh-readout";
import { StatusBadge } from "@/src/components/projects/project-status-badge";
import {
  errorMessageFromJsonBody,
  readResponseJson,
} from "@/src/lib/fetch-json";

const docsFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:focus-visible:ring-zinc-500/50 dark:focus-visible:ring-offset-zinc-950";

/**
 * Deep link for `flux open <slug>` — Mesh Readout for a single project.
 */
export default function ProjectMeshReadoutPage(): React.ReactElement {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";

  const [project, setProject] = useState<ProjectRow | null | undefined>(
    undefined,
  );
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    setErr(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}`);
      const payload: unknown = await readResponseJson(res, {
        apiLabel: "projects API",
      });
      if (!res.ok) {
        throw new Error(
          errorMessageFromJsonBody(
            payload,
            `Request failed (${String(res.status)})`,
          ),
        );
      }
      if (!payload || typeof payload !== "object") {
        throw new Error("Invalid response from project API.");
      }
      setProject(payload as ProjectRow);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setProject(null);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!slug) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10 font-mono text-sm text-red-400">
        Missing project slug.
      </div>
    );
  }

  if (err) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10">
        <p className="font-mono text-sm text-red-400">{err}</p>
        <Link
          href="/projects"
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to fleet
        </Link>
      </div>
    );
  }

  if (project === undefined) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-600" aria-label="Loading" />
      </div>
    );
  }

  if (project === null) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10">
        <p className="font-mono text-sm text-zinc-400">
          No project with slug <span className="text-zinc-200">{slug}</span> in
          your catalog.
        </p>
        <Link
          href="/projects"
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to fleet
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 flex-col px-4 py-8 sm:px-8">
      <ProjectHeader
        variant="flush"
        title={project.name}
        subtitle={project.slug}
        statusRow={
          <>
            <StatusBadge status={project.status} />
            <MeshTelemetryPill
              healthStatus={project.healthStatus}
              lastHeartbeatAt={project.lastHeartbeatAt}
              createdAt={project.createdAt}
              stackStatus={project.status}
            />
          </>
        }
        primaryActions={
          <>
            <Link
              href="/docs"
              className={`inline-flex h-9 shrink-0 items-center rounded-md px-3 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100 ${docsFocus}`}
            >
              Docs
            </Link>
            <Link
              href="/projects"
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to projects
            </Link>
          </>
        }
      />
      <ProjectMeshReadout project={project} />
    </div>
  );
}
