import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function resolveCliBundlePath(): Promise<string> {
  const fromNodeModules = join(
    process.cwd(),
    "node_modules",
    "@flux/cli",
    "dist",
    "index.js",
  );
  try {
    await access(fromNodeModules);
    return fromNodeModules;
  } catch {
    return join(process.cwd(), "..", "..", "packages", "cli", "dist", "index.js");
  }
}

/**
 * GET /api/install/cli — bundled ESM entry for the `flux` CLI (Node 20+).
 */
export async function GET(): Promise<Response> {
  const path = await resolveCliBundlePath();
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error:
          "CLI bundle not found. Build the monorepo with `pnpm --filter @flux/cli run build` before serving.",
        detail: msg,
      },
      { status: 503 },
    );
  }
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=300",
    },
  });
}
