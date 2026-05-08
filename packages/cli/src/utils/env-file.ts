import { access, constants, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { FLUX_JSON } from "../flux-config";

/** Public hosted control-plane API base (same default as `ApiClient`). */
export const HOSTED_FLUX_PUBLIC_API_BASE = "https://flux.vsl-base.com/api";

/**
 * If `FLUX_URL` is a tenant Service URL on hosted Flux (`*.vsl-base.com`), the control plane
 * API base is fixed; callers need not duplicate `FLUX_API_BASE` in `.env`.
 *
 * Matches flattened `api--slug--hash.vsl-base.com` and legacy `api.slug.hash.vsl-base.com`.
 */
export function inferHostedFluxApiBaseFromFluxUrl(
  fluxUrl: string | undefined,
): string | null {
  const raw = fluxUrl?.trim();
  if (!raw) return null;
  let hostname: string;
  try {
    hostname = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
  const onBase =
    hostname === "vsl-base.com" || hostname.endsWith(".vsl-base.com");
  if (!onBase) return null;
  const flat = /^api--.+--[a-f0-9]{7}\.vsl-base\.com$/iu.test(hostname);
  const legacy = /^api\.[^.]+\.[a-f0-9]{7}\.vsl-base\.com$/iu.test(hostname);
  if (!flat && !legacy) return null;
  return HOSTED_FLUX_PUBLIC_API_BASE;
}

/**
 * Minimal `KEY=value` parser for a local `.env` file. No interpolation, no
 * exports, no escapes. Intended for resolving a single secret (e.g.
 * `FLUX_GATEWAY_JWT_SECRET`) without taking a `dotenv` dependency.
 *
 * Supported syntax (one entry per line):
 *   KEY=value
 *   KEY="value with spaces"
 *   KEY='value with spaces'
 *   # comments and blank lines are ignored
 *   KEY= (empty values are kept as "")
 *
 * Lines without an `=` are silently ignored. The first occurrence of a key wins.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || /\s/.test(key)) continue;
    if (key in out) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Reads `<cwd>/.env` and returns the parsed map. Returns `{}` if the file is
 * absent or unreadable — callers should treat this as "no values" and fall
 * through to other sources (process.env, prompts, errors).
 */
export async function readEnvFile(cwd: string): Promise<Record<string, string>> {
  try {
    const text = await readFile(join(cwd, ".env"), "utf8");
    return parseEnvFile(text);
  } catch {
    return {};
  }
}

async function fileReadable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads `<cwd>/.env.local` when present (Next.js convention). Same parsing as {@link readEnvFile}.
 */
export async function readEnvLocalFile(cwd: string): Promise<Record<string, string>> {
  try {
    const text = await readFile(join(cwd, ".env.local"), "utf8");
    return parseEnvFile(text);
  } catch {
    return {};
  }
}

/**
 * Merges `.env` then `.env.local` from `cwd`. Keys in `.env.local` override `.env`.
 */
export async function loadMergedProjectEnvFiles(cwd: string): Promise<Record<string, string>> {
  const base = await readEnvFile(cwd);
  const local = await readEnvLocalFile(cwd);
  return { ...base, ...local };
}

/**
 * Walks up from `startCwd` to find the nearest directory containing `flux.json`.
 * If none exists, returns `resolve(startCwd)` so `.env` next to the shell cwd still applies.
 */
export async function resolveFluxProjectRootForEnv(startCwd: string): Promise<string> {
  let dir = resolve(startCwd);
  for (;;) {
    if (await fileReadable(join(dir, FLUX_JSON))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return resolve(startCwd);
    }
    dir = parent;
  }
}

/**
 * Variables merged from the project `.env` / `.env.local` into `process.env` when missing there.
 * Shell / CI exports always win (we do not override non-empty `process.env` values).
 */
export const FLUX_CLI_DOTENV_KEYS = [
  "FLUX_API_BASE",
  "FLUX_DASHBOARD_BASE",
  "FLUX_API_TOKEN",
  "FLUX_DEFAULT_MODE",
  "FLUX_GATEWAY_JWT_SECRET",
] as const;

export type FluxCliDotenvKey = (typeof FLUX_CLI_DOTENV_KEYS)[number];

/**
 * Populates `process.env` from the project’s merged `.env` / `.env.local` (see
 * {@link resolveFluxProjectRootForEnv}) for known CLI keys. Call once at process startup
 * before constructing {@link ApiClient} or reading tokens from the environment.
 */
export async function hydrateProcessEnvFromProjectFiles(
  startCwd: string = process.cwd(),
): Promise<void> {
  const root = await resolveFluxProjectRootForEnv(startCwd);
  const merged = await loadMergedProjectEnvFiles(root);
  for (const key of FLUX_CLI_DOTENV_KEYS) {
    if (process.env[key]?.trim()) continue;
    const v = merged[key]?.trim();
    if (v) process.env[key] = v;
  }

  if (!process.env.FLUX_API_BASE?.trim()) {
    const fluxUrl =
      process.env.FLUX_URL?.trim() ||
      process.env.NEXT_PUBLIC_FLUX_URL?.trim() ||
      merged.FLUX_URL?.trim() ||
      merged.NEXT_PUBLIC_FLUX_URL?.trim();
    const inferred = inferHostedFluxApiBaseFromFluxUrl(fluxUrl);
    if (inferred) process.env.FLUX_API_BASE = inferred;
  }
}
