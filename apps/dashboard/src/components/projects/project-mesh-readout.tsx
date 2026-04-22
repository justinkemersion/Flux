"use client";

import { LogConsole } from "@/src/components/projects/log-console";
import { ProjectManifest } from "@/src/components/projects/project-manifest";
import { TelemetrySparkline } from "@/src/components/projects/telemetry-sparkline";

type Props = { slug: string; hash: string };

/**
 * Mesh readout: telemetry blocks, connection manifest, embedded log stream.
 */
export function ProjectMeshReadout({ slug, hash }: Props) {
  return (
    <div className="mb-4 space-y-4 font-mono">
      <TelemetrySparkline slug={slug} />
      <ProjectManifest slug={slug} />
      <LogConsole key={`${slug}-${hash}`} slug={slug} hash={hash} />
    </div>
  );
}
