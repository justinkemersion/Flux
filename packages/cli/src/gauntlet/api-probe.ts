import { mintServiceRoleJwt } from "../lib/migrations-remote";
import type { GauntletMode } from "./types";

export interface OpenApiIntrospection {
  hasGauntletNotes: boolean;
  hasGauntletEvents: boolean;
  notePath?: string;
  eventPath?: string;
  paths: string[];
}

function collectPaths(openapi: Record<string, unknown>): string[] {
  const paths = openapi.paths;
  if (!paths || typeof paths !== "object") return [];
  return Object.keys(paths as Record<string, unknown>);
}

/** Verify PostgREST schema cache exposes gauntlet tables via OpenAPI paths. */
export function inspectOpenApiSchema(
  openapi: Record<string, unknown>,
): OpenApiIntrospection {
  const paths = collectPaths(openapi);
  const notePath = paths.find((p) => /\/gauntlet_notes$/u.test(p));
  const eventPath = paths.find((p) => /\/gauntlet_events$/u.test(p));
  return {
    hasGauntletNotes: notePath !== undefined,
    hasGauntletEvents: eventPath !== undefined,
    ...(notePath !== undefined ? { notePath } : {}),
    ...(eventPath !== undefined ? { eventPath } : {}),
    paths,
  };
}

export function formatIntrospectionSummary(
  intro: OpenApiIntrospection,
): string {
  const parts: string[] = [];
  if (intro.hasGauntletNotes) parts.push("gauntlet_notes");
  if (intro.hasGauntletEvents) parts.push("gauntlet_events");
  if (parts.length === 0) return "OpenAPI paths missing gauntlet tables";
  return `${String(parts.length)} table(s) visible in PostgREST cache: ${parts.join(", ")}`;
}

export interface ApiProbeContext {
  apiUrl: string;
  apiSchema: string;
  mode: GauntletMode;
  serviceRoleJwt?: string;
  anonJwt?: string;
  projectJwt?: string;
  hash: string;
}

function apiHeaders(
  ctx: ApiProbeContext,
  method: "GET" | "POST",
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (ctx.mode === "v1_dedicated") {
    const token =
      method === "GET"
        ? (ctx.anonJwt ?? ctx.serviceRoleJwt)
        : ctx.serviceRoleJwt;
    if (!token?.trim()) {
      throw new Error(
        `v1_dedicated API probe (${method}) requires ${method === "GET" ? "anonJwt or serviceRoleJwt" : "serviceRoleJwt"}`,
      );
    }
    headers.Authorization = `Bearer ${token.trim()}`;
    if (ctx.apiSchema !== "api") {
      headers[method === "GET" ? "Accept-Profile" : "Content-Profile"] =
        ctx.apiSchema;
    }
    return headers;
  }

  if (!ctx.projectJwt?.trim()) {
    throw new Error("v2_shared API probe requires projectJwt");
  }
  headers.Authorization = `Bearer ${mintServiceRoleJwt(ctx.projectJwt.trim(), ctx.hash)}`;
  headers[method === "GET" ? "Accept-Profile" : "Content-Profile"] =
    ctx.apiSchema;
  return headers;
}

async function parseJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `API response was not JSON (HTTP ${String(res.status)}): ${text.slice(0, 200)}`,
    );
  }
}

export async function probeInsertNote(
  ctx: ApiProbeContext,
): Promise<{ id: number }> {
  const base = ctx.apiUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/gauntlet_notes`, {
    method: "POST",
    headers: {
      ...apiHeaders(ctx, "POST"),
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      title: "gauntlet probe",
      body: "inserted by flux gauntlet",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await parseJsonResponse(res);
  if (!res.ok) {
    throw new Error(
      `POST gauntlet_notes failed: HTTP ${String(res.status)} ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  const row = Array.isArray(body) ? body[0] : body;
  if (!row || typeof row !== "object" || !("id" in row)) {
    throw new Error("POST gauntlet_notes did not return row with id");
  }
  const id = Number((row as { id: unknown }).id);
  if (!Number.isFinite(id)) {
    throw new Error("POST gauntlet_notes returned non-numeric id");
  }
  return { id };
}

export async function probeSelectNote(
  ctx: ApiProbeContext,
  noteId: number,
): Promise<void> {
  const base = ctx.apiUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/gauntlet_notes?id=eq.${String(noteId)}`, {
    method: "GET",
    headers: apiHeaders(ctx, "GET"),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await parseJsonResponse(res);
  if (!res.ok) {
    throw new Error(
      `GET gauntlet_notes failed: HTTP ${String(res.status)} ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  if (!Array.isArray(body) || body.length !== 1) {
    throw new Error(
      `GET gauntlet_notes?id=eq.${String(noteId)} expected exactly one row`,
    );
  }
}

export async function probeInsertEvent(
  ctx: ApiProbeContext,
  noteId: number,
): Promise<{ id: number }> {
  const base = ctx.apiUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/gauntlet_events`, {
    method: "POST",
    headers: {
      ...apiHeaders(ctx, "POST"),
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      note_id: noteId,
      event_type: "gauntlet_probe",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await parseJsonResponse(res);
  if (!res.ok) {
    throw new Error(
      `POST gauntlet_events failed: HTTP ${String(res.status)} ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  const row = Array.isArray(body) ? body[0] : body;
  if (!row || typeof row !== "object" || !("id" in row)) {
    throw new Error("POST gauntlet_events did not return row with id");
  }
  const id = Number((row as { id: unknown }).id);
  if (!Number.isFinite(id)) {
    throw new Error("POST gauntlet_events returned non-numeric id");
  }
  return { id };
}

export async function probeSelectEventByNoteId(
  ctx: ApiProbeContext,
  noteId: number,
): Promise<void> {
  const base = ctx.apiUrl.replace(/\/$/, "");
  const res = await fetch(
    `${base}/gauntlet_events?note_id=eq.${String(noteId)}&select=id,note_id,event_type`,
    {
      method: "GET",
      headers: apiHeaders(ctx, "GET"),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const body = await parseJsonResponse(res);
  if (!res.ok) {
    throw new Error(
      `GET gauntlet_events failed: HTTP ${String(res.status)} ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  if (!Array.isArray(body) || body.length < 1) {
    throw new Error(
      `GET gauntlet_events?note_id=eq.${String(noteId)} expected at least one row`,
    );
  }
}
