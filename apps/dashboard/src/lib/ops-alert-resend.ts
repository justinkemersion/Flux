/**
 * Resend HTTP transport for ops alerts.
 * POST https://api.resend.com/emails — used when FLUX_RESEND_API_KEY is set.
 */

import type { SmtpMail } from "./ops-alert-smtp.ts";

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";
export const DEFAULT_RESEND_FROM = "Flux Alerts <onboarding@resend.dev>";
export const DEFAULT_RESEND_TIMEOUT_MS = 15_000;

export type ResendTransportConfig = {
  apiKey: string;
  timeoutMs: number;
  endpoint?: string;
};

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export async function sendResendMail(
  config: ResendTransportConfig,
  mail: SmtpMail,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (mail.to.length === 0) {
    throw new Error("Resend send requires at least one recipient");
  }
  const endpoint = config.endpoint ?? RESEND_EMAILS_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      }),
      signal: controller.signal,
    });
    if (res.ok) return;
    const raw = await res.text();
    throw new Error(`Resend HTTP ${String(res.status)}: ${summarizeResendError(raw)}`);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Resend timed out after ${String(config.timeoutMs)}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function summarizeResendError(raw: string): string {
  const trimmed = raw.trim().slice(0, 400);
  if (!trimmed) return "(empty body)";
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown; name?: unknown };
    if (typeof parsed.message === "string" && parsed.message.length > 0) {
      return parsed.message;
    }
  } catch {
    // keep raw
  }
  return trimmed;
}
