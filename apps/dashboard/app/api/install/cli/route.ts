import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const RELATIVE_BUNDLE = join("packages", "cli", "dist", "index.js");

/**
 * `packages/cli/dist/index.js` from the monorepo root. Tries common process.cwd()
 * layouts (monorepo root, apps/dashboard) without walking parent directories, so
 * the path stays friendly to the bundler’s static analysis.
 */
function resolveCliPathFromMonorepoRoot(): string | null {
  const candidates = [
    join(/* turbopackIgnore: true */ process.cwd(), RELATIVE_BUNDLE),
    join(/* turbopackIgnore: true */ process.cwd(), "..", "..", RELATIVE_BUNDLE),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return null;
}

const BUILD_HINT =
  "Build the CLI first: pnpm --filter @flux/cli run build (produces packages/cli/dist/index.js).";

/**
 * GET /api/install/cli — stream the bundled ESM `flux` CLI (Node 20+).
 */
export function GET() {
  const filePath = resolveCliPathFromMonorepoRoot();
  if (!filePath) {
    return NextResponse.json(
      { error: "CLI bundle not found at packages/cli/dist/index.js.", hint: BUILD_HINT },
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
