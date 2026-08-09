import {
  FLUX_GATEWAY_CONTRACT_VERSION,
  FLUX_POOLED_PUSH_ADAPTER_CONTRACT,
} from "@flux/core/contract-versions";
import type { ControlPlaneProvenance } from "@flux/core/control-plane-provenance";
import pkg from "../../package.json" with { type: "json" };

/**
 * Build provenance of this control-plane artifact.
 *
 * `FLUX_BUILD_*` are inlined by Next's `env` config during `next build` (see next.config.ts),
 * so these reads are compile-time constants in the emitted server bundle and cannot be
 * overridden by the container's runtime environment. Values arrive from Docker build args set
 * by `bin/deploy-web.sh`, which is the only component that can see `.git` — the build context
 * excludes it.
 *
 * Contract versions are imported from source, so they always describe the code in this
 * artifact rather than something an operator typed.
 */
export function getControlPlaneProvenance(): ControlPlaneProvenance {
  const sha = normalize(process.env.FLUX_BUILD_SOURCE_SHA);
  const dirty = normalize(process.env.FLUX_BUILD_DIRTY);
  return {
    version: pkg.version,
    sourceSha: sha,
    dirtyAtBuild: dirty == null ? null : dirty === "1" || dirty === "true",
    buildTimestamp: normalize(process.env.FLUX_BUILD_TIMESTAMP),
    gatewayContractVersion: FLUX_GATEWAY_CONTRACT_VERSION,
    pooledPushAdapterContract: FLUX_POOLED_PUSH_ADAPTER_CONTRACT,
  };
}

function normalize(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
