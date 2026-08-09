import { classifyControlPlaneProvenance } from "@flux/core/control-plane-provenance";
import { getControlPlaneProvenance } from "@/src/lib/build-provenance";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Liveness plus the build identity of this control plane. Operators and `flux` need this to
 * prove which commit handles pooled migration requests, because the pooled push SQL adapter
 * runs here rather than in the CLI.
 *
 * Unauthenticated by design. The deploy guard must verify a candidate container before it is
 * routed (no credentials available there), and the CLI preflight must verify before it commits
 * to a production mutation. Every field is a build identifier from a public repository: no
 * secrets, credentials, tenant identifiers, environment values, or filesystem paths.
 *
 * Always 200 while the process serves. Provenance problems are reported in `provenanceStatus`
 * rather than as a failed health check: the app is running, it just cannot be identified, and
 * turning that into 503 would tell orchestrators to restart a working container. Callers that
 * require identity (deploy guard, migration preflight) read the body.
 */
export function GET() {
  const provenance = getControlPlaneProvenance();
  const verdict = classifyControlPlaneProvenance(provenance);
  return NextResponse.json(
    {
      ok: true,
      status: "ok",
      provenanceStatus: verdict.status,
      provenanceDetail: verdict.detail,
      provenance,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
