/**
 * Shared parsing for `fetch` responses to the Next.js `/api` routes. HTML from a misconfigured
 * reverse proxy or an empty body with invalid status would break `res.json()` or hide errors.
 */

export const REVERSE_PROXY_HINT =
  "If you use a reverse proxy, ensure /api is forwarded to this Next.js app, not a static file or other host.";

export type ReadResponseJsonOptions = {
  /** e.g. "projects API" → "The projects API did not return valid JSON …" */
  apiLabel: string;
  /**
   * When true (default), a body that is empty or only whitespace parses as `null` instead of
   * throwing. Use false when a JSON value is required.
   */
  allowEmptyBody?: boolean;
};

function contentTypePart(res: Response): string {
  return res.headers.get("content-type")?.split(";")[0]?.trim() ?? "unknown";
}

/**
 * Parse a response body that was already read as text. Prefer this + `res.text()` so the body
 * is only read once and non-JSON responses get a clear error.
 */
export function parseResponseBodyAsJson(
  res: Response,
  text: string,
  options: ReadResponseJsonOptions,
): unknown {
  const { apiLabel, allowEmptyBody = true } = options;
  const trimmed = text.trim();
  if (!trimmed) {
    if (allowEmptyBody) return null;
    const ct = contentTypePart(res);
    throw new Error(
      `The ${apiLabel} did not return valid JSON (HTTP ${String(res.status)}, ${ct}): empty body. ${REVERSE_PROXY_HINT}`,
    );
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const ct = contentTypePart(res);
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 160);
    const hint = trimmed.startsWith("<")
      ? " (response looks like HTML: forward PathPrefix /api to this Next.js app; if a CDN fronts the host, purge or disable cache for /api/* — never cache it as static HTML.)"
      : preview
        ? `: ${preview}${text.length > 160 ? "…" : ""}`
        : " (empty body)";
    throw new Error(
      `The ${apiLabel} did not return valid JSON (HTTP ${String(res.status)}, ${ct})${hint}. ${REVERSE_PROXY_HINT}`,
    );
  }
}

export async function readResponseJson(
  res: Response,
  options: ReadResponseJsonOptions,
): Promise<unknown> {
  const text = await res.text();
  return parseResponseBodyAsJson(res, text, options);
}

/** Prefer a server-provided `error` string; otherwise use `fallback`. */
export function errorMessageFromJsonBody(
  payload: unknown,
  fallback: string,
): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return fallback;
}
