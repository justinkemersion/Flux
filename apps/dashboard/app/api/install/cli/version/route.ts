import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Tries to read @flux/cli version from the monorepo; falls back when the bundle
 * is deployed without the full source tree.
 */
function readCliVersionFromMonorepo(): string | null {
  const candidates = [
    join(process.cwd(), "packages", "cli", "package.json"),
    join(process.cwd(), "..", "..", "packages", "cli", "package.json"),
    join(process.cwd(), "..", "packages", "cli", "package.json"),
  ];
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    try {
      const raw = readFileSync(c, "utf8");
      const p = JSON.parse(raw) as { version?: string };
      const v = typeof p.version === "string" ? p.version.trim() : "";
      if (v) return v;
    } catch {
      /* */
    }
  }
  return null;
}

/**
 * GET /api/install/cli/version
 * Exposes the published CLI version for the client `flux` binary (V1+ update hints).
 */
export function GET() {
  const v =
    process.env.FLUX_CLI_LATEST_VERSION?.trim() || readCliVersionFromMonorepo() || "1.0.0";
  return NextResponse.json(
    { version: v },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
