"use client";

import type { ProjectRow } from "@/src/components/projects/project-card";
import { ProjectExportControl } from "@/src/components/projects/project-export-control";
import { LogConsole } from "@/src/components/projects/log-console";
import { ProjectManifest } from "@/src/components/projects/project-manifest";
import { TelemetrySparkline } from "@/src/components/projects/telemetry-sparkline";

type Props = { project: ProjectRow };

/**
 * Mesh readout: telemetry blocks, connection manifest, embedded log stream.
 */
export function ProjectMeshReadout({ project }: Props) {
  return (
    <div className="mb-4 space-y-4 font-mono">
      <TelemetrySparkline
        slug={project.slug}
        createdAt={project.createdAt}
        stackStatus={project.status}
        healthStatus={project.healthStatus}
        lastHeartbeatAt={project.lastHeartbeatAt}
      />
      <ProjectManifest slug={project.slug} />
      <ProjectExportControl hash={project.hash} />
      <LogConsole
        key={`${project.slug}-${project.hash}`}
        slug={project.slug}
        hash={project.hash}
      />
    </div>
  );
}
