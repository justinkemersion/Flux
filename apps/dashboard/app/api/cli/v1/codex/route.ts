import { NextResponse } from "next/server";
import { FLUX_CODEX_JSON } from "@/src/lib/flux-codex-static";

export async function GET() {
  return NextResponse.json(FLUX_CODEX_JSON);
}
