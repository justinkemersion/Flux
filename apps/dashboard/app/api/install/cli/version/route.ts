import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/install/cli/version
 * Exposes the published CLI version for the client `flux` binary (V1+ update hints).
 */
export function GET() {
  const v = process.env.FLUX_CLI_LATEST_VERSION?.trim() || "1.0.0";
  return NextResponse.json(
    { version: v },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
