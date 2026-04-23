"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  type ProjectRow,
} from "@/src/components/projects/project-card";
import { ProjectMeshReadout } from "@/src/components/projects/project-mesh-readout";

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
      const res = await fetch("/api/projects");
      const text = await res.text();
      const payload: unknown = text.trim() ? JSON.parse(text) as unknown : null;
      if (!res.ok) {
        const msg =
          payload &&
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof (payload as { error: unknown }).error === "string"
            ? (payload as { error: string }).error
            : `Request failed (${String(res.status)})`;
        throw new Error(msg);
      }
      if (
        !payload ||
        typeof payload !== "object" ||
        !("projects" in payload) ||
        !Array.isArray((payload as { projects: unknown }).projects)
      ) {
        throw new Error("Invalid response from projects API.");
      }
      const list = (payload as { projects: ProjectRow[] }).projects;
      setProject(list.find((p) => p.slug === slug) ?? null);
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
          className="mt-4 inline-flex items-center gap-2 border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300 hover:border-zinc-600"
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
          className="mt-4 inline-flex items-center gap-2 border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300 hover:border-zinc-600"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to fleet
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 flex-col px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/projects"
          className="inline-flex items-center gap-2 border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300 hover:border-zinc-600"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          FLEET
        </Link>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          MESH_READOUT / {project.slug}
        </span>
      </div>
      <ProjectMeshReadout project={project} />
    </div>
  );
}
