import { describeFailedApiResponse } from "./http-errors";

/** Parse `fetch` response text as JSON; empty body → `null`. */
export function parseJsonResponseBody(
  text: string,
  notJsonMessage: string,
): unknown {
  try {
    return text.trim() ? (JSON.parse(text) as unknown) : null;
  } catch {
    throw new Error(notJsonMessage);
  }
}

/**
 * Matches most CLI branches when `!res.ok`: prefer top-level `error` string, else generic status message.
 */
export function errorMessageFromJsonBody(body: unknown, status: number): string {
  if (
    body &&
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string"
  ) {
    return (body as { error: string }).error;
  }
  return `Request failed (${String(status)})`;
}

export function throwIfNotOkDescribeFailed(
  res: Response,
  body: unknown,
  text: string,
): void {
  if (!res.ok) {
    throw new Error(describeFailedApiResponse(res.status, body, text));
  }
}
