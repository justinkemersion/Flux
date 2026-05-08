import { createReadStream } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function resolveCliBundlePath(): string | null {
  const envPath = process.env.FLUX_CLI_BUNDLE_PATH?.trim();
  if (envPath && existsSync(envPath)) return envPath;

  const staticCandidates = [
    join("/app", "packages", "cli", "dist", "index.cjs"),
    join("/workspace", "packages", "cli", "dist", "index.cjs"),
  ];
  for (const p of staticCandidates) {
    if (existsSync(p)) return p;
  }

  return null;
}

const BUILD_HINT =
  "Build the CLI first: pnpm --filter @flux/cli run build (produces packages/cli/dist/index.cjs).";

/**
 * GET /api/install/cli — stream the bundled CommonJS `flux` CLI (Node 20+).
 */
export function GET() {
  const filePath = resolveCliBundlePath();
  if (!filePath) {
    return NextResponse.json(
      { error: "CLI bundle not found at packages/cli/dist/index.cjs.", hint: BUILD_HINT },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const nodeStream = createReadStream(filePath);
  const web = Readable.toWeb(nodeStream);
  return new NextResponse(web as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript",
      "Content-Disposition": "attachment; filename=\"flux\"",
      "Cache-Control": "no-store",
    },
  });
}
