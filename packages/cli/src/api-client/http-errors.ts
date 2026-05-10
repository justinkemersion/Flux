export function messageFromApiErrorBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  for (const key of ["error", "message", "detail"] as const) {
    const v = o[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

/** When `!res.ok`, build a useful CLI message from JSON or a short raw body snippet. */
export function describeFailedApiResponse(
  status: number,
  body: unknown,
  rawText: string,
): string {
  const fromJson = messageFromApiErrorBody(body);
  if (fromJson) return fromJson;
  const t = rawText.trim();
  if (
    t.length > 0 &&
    !t.startsWith("<!DOCTYPE") &&
    !t.toLowerCase().startsWith("<html")
  ) {
    const max = 500;
    return `Request failed (${String(status)}): ${t.length > max ? `${t.slice(0, max)}…` : t}`;
  }
  return `Request failed (${String(status)})`;
}
