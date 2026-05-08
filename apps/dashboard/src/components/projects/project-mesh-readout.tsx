"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { ProjectRow } from "@/src/components/projects/project-types";
import { V1DedicatedConnectSection } from "@/src/components/projects/v1-dedicated-connect-section";
import { ProjectExportControl } from "@/src/components/projects/project-export-control";
import { LogConsole } from "@/src/components/projects/log-console";
import { ProjectManifest } from "@/src/components/projects/project-manifest";
import { TelemetrySparkline } from "@/src/components/projects/telemetry-sparkline";

type Props = {
  project: ProjectRow;
  /**
   * `embedded`: show v1-only Postgres/API key panel (e.g. `/projects/[slug]` without ProjectCard).
   * Default `none`: fleet project modal renders credentials on ProjectCard below—omit here to avoid duplication.
   */
  credentialSurface?: "none" | "embedded";
};

/**
 * Mesh readout: telemetry blocks, connection manifest, embedded log stream.
 */
export function ProjectMeshReadout({
  project,
  credentialSurface = "none",
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="mb-4 space-y-5">
      {credentialSurface === "embedded" && project.mode !== "v2_shared" ? (
        <V1DedicatedConnectSection project={project} />
      ) : null}
      <ProjectManifest slug={project.slug} />

      <section id={`database-${project.slug}`}>
        <ProjectExportControl hash={project.hash} />
      </section>

      <section id={`logs-${project.slug}`}>
        <LogConsole
          key={`${project.slug}-${project.hash}`}
          slug={project.slug}
          hash={project.hash}
          mode={project.mode}
        />
      </section>

      <section className="rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/40">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Advanced
          </span>
          <ChevronDown
            className={`h-4 w-4 text-zinc-500 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
        {advancedOpen ? (
          <div className="border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
            <TelemetrySparkline
              slug={project.slug}
              createdAt={project.createdAt}
              stackStatus={project.status}
              healthStatus={project.healthStatus}
              lastHeartbeatAt={project.lastHeartbeatAt}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
