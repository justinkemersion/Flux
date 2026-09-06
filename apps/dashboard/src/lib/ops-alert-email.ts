/**
 * Optional SMTP email alerts for control-plane ops failures.
 * Disabled unless FLUX_ALERT_EMAIL_TO and SMTP (host or URL) are set.
 */

import { sendSmtpMail, type SmtpMail, type SmtpTransportConfig } from "./ops-alert-smtp.ts";

export const DEFAULT_ALERT_EMAIL_FROM = "flux-alerts@vsl-base.com";
export const DEFAULT_ALERT_DEDUPE_HOURS = 6;
export const DEFAULT_SMTP_TIMEOUT_MS = 15_000;

export type OpsAlertTransport = {
  send(mail: SmtpMail): Promise<void>;
};

export type OpsAlertConfig = {
  to: string[];
  from: string;
  smtp: SmtpTransportConfig;
  dedupeMs: number;
};

export type OpsAlertInput = {
  fingerprint: string;
  subject: string;
  body: string;
};

export type OpsAlertResult =
  | { status: "sent" }
  | { status: "skipped"; reason: "disabled" | "deduped" }
  | { status: "failed"; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let loggedDisabled = false;
let lastSentByFingerprint = new Map<string, number>();
let testHooks:
  | {
      transport?: OpsAlertTransport;
      env?: OpsAlertEnv;
    }
  | undefined;

export type OpsAlertEnv = Record<string, string | undefined>;

function envTruthy(env: OpsAlertEnv, name: string): boolean | undefined {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return undefined;
}

function readEnv(env: OpsAlertEnv, name: string): string | undefined {
  const v = env[name]?.trim();
  return v && v.length > 0 ? v : undefined;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseEmailList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => EMAIL_RE.test(s));
}

export function parseSmtpUrl(raw: string): {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
} {
  const url = new URL(raw);
  const protocol = url.protocol.replace(/:$/, "").toLowerCase();
  if (protocol !== "smtp" && protocol !== "smtps") {
    throw new Error(`FLUX_SMTP_URL must be smtp:// or smtps:// (got ${url.protocol})`);
  }
  const host = url.hostname;
  if (!host) throw new Error("FLUX_SMTP_URL is missing a host");
  const secure = protocol === "smtps";
  const port = url.port ? Number.parseInt(url.port, 10) : secure ? 465 : 587;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("FLUX_SMTP_URL has an invalid port");
  }
  const user = url.username ? decodeURIComponent(url.username) : undefined;
  const pass = url.password ? decodeURIComponent(url.password) : undefined;
  return { host, port, secure, user, pass };
}

export function parseOpsAlertConfig(
  env: OpsAlertEnv = process.env,
): OpsAlertConfig | null {
  const toRaw = readEnv(env, "FLUX_ALERT_EMAIL_TO");
  if (!toRaw) return null;
  const to = parseEmailList(toRaw);
  if (to.length === 0) return null;

  let host: string | undefined;
  let port = 587;
  let secure = false;
  let user: string | undefined;
  let pass: string | undefined;

  const urlRaw = readEnv(env, "FLUX_SMTP_URL");
  if (urlRaw) {
    try {
      const parsed = parseSmtpUrl(urlRaw);
      host = parsed.host;
      port = parsed.port;
      secure = parsed.secure;
      user = parsed.user;
      pass = parsed.pass;
    } catch {
      return null;
    }
  } else {
    host = readEnv(env, "FLUX_SMTP_HOST");
    if (!host) return null;
    port = parsePositiveInt(readEnv(env, "FLUX_SMTP_PORT"), 587);
    user = readEnv(env, "FLUX_SMTP_USER");
    pass = readEnv(env, "FLUX_SMTP_PASS");
    const secureFlag = envTruthy(env, "FLUX_SMTP_SECURE");
    secure = secureFlag ?? port === 465;
  }

  if (!host) return null;

  const from = readEnv(env, "FLUX_ALERT_EMAIL_FROM") ?? DEFAULT_ALERT_EMAIL_FROM;
  const dedupeHours = parsePositiveInt(
    readEnv(env, "FLUX_ALERT_EMAIL_DEDUPE_HOURS"),
    DEFAULT_ALERT_DEDUPE_HOURS,
  );
  const timeoutMs = parsePositiveInt(
    readEnv(env, "FLUX_SMTP_TIMEOUT_MS"),
    DEFAULT_SMTP_TIMEOUT_MS,
  );

  return {
    to,
    from,
    smtp: { host, port, secure, user, pass, timeoutMs },
    dedupeMs: dedupeHours * 60 * 60 * 1000,
  };
}

export function formatOpsAlertBody(input: {
  source: string;
  message: string;
  error: string;
  when?: Date;
  projectSlug?: string;
  projectHash?: string;
  backupId?: string;
}): string {
  const when = (input.when ?? new Date()).toISOString();
  const project =
    input.projectSlug && input.projectHash
      ? `${input.projectSlug}:${input.projectHash}`
      : undefined;
  const lines = [
    `source: ${input.source}`,
    `when: ${when}`,
    project ? `project: ${project}` : null,
    input.backupId ? `backupId: ${input.backupId}` : null,
    `error: ${input.message}`,
    input.error && input.error !== input.message ? `detail: ${input.error}` : null,
  ];
  return lines.filter((line): line is string => line != null).join("\n");
}

export function createSmtpOpsAlertTransport(config: SmtpTransportConfig): OpsAlertTransport {
  return {
    send(mail: SmtpMail) {
      return sendSmtpMail(config, mail);
    },
  };
}

export function setOpsAlertTestHooks(hooks?: {
  transport?: OpsAlertTransport;
  env?: OpsAlertEnv;
}): void {
  testHooks = hooks;
}

export function resetOpsAlertStateForTests(): void {
  loggedDisabled = false;
  lastSentByFingerprint = new Map();
  testHooks = undefined;
}

function logDisabledOnce(): void {
  if (loggedDisabled) return;
  loggedDisabled = true;
  console.debug(
    "[flux] ops-alert-email: disabled (set FLUX_ALERT_EMAIL_TO and FLUX_SMTP_HOST or FLUX_SMTP_URL to enable)",
  );
}

export async function sendOpsAlert(
  input: OpsAlertInput,
  options?: {
    env?: OpsAlertEnv;
    nowMs?: number;
    transport?: OpsAlertTransport;
  },
): Promise<OpsAlertResult> {
  try {
    const env = options?.env ?? testHooks?.env ?? process.env;
    const config = parseOpsAlertConfig(env);
    if (!config) {
      logDisabledOnce();
      return { status: "skipped", reason: "disabled" };
    }

    const nowMs = options?.nowMs ?? Date.now();
    const last = lastSentByFingerprint.get(input.fingerprint);
    if (last != null && nowMs - last < config.dedupeMs) {
      return { status: "skipped", reason: "deduped" };
    }

    const transport =
      options?.transport ?? testHooks?.transport ?? createSmtpOpsAlertTransport(config.smtp);
    await transport.send({
      from: config.from,
      to: config.to,
      subject: input.subject,
      text: input.body,
    });
    lastSentByFingerprint.set(input.fingerprint, nowMs);
    return { status: "sent" };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[flux] ops-alert-email: send failed — ${error}`);
    return { status: "failed", error };
  }
}

/** Fire-and-forget wrapper so callers never fail because mail failed. */
export function queueOpsAlert(
  input: OpsAlertInput,
  options?: {
    env?: OpsAlertEnv;
    nowMs?: number;
    transport?: OpsAlertTransport;
  },
): void {
  void sendOpsAlert(input, options);
}
