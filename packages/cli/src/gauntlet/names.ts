import { randomBytes } from "node:crypto";

/** Default disposable project prefix when --prefix is omitted. */
export const DEFAULT_GAUNTLET_PREFIX = "gauntlet";

/**
 * Slug-safe disposable name: `<prefix>-<unixTs>-<shortRandom>`.
 * The control plane slugifies on create; we validate the returned slug separately.
 */
export function generateGauntletProjectName(prefix?: string): string {
  const base = (prefix?.trim() || DEFAULT_GAUNTLET_PREFIX).toLowerCase();
  const ts = Math.floor(Date.now() / 1000);
  const rand = randomBytes(3).toString("hex");
  return `${base}-${String(ts)}-${rand}`;
}

/**
 * Strict marker for gauntlet-owned projects.
 * Format: `<prefix>-<digits>-<hex>` (prefix defaults to `gauntlet`).
 */
export function isGauntletSlug(slug: string, prefix?: string): boolean {
  const p = (prefix?.trim() || DEFAULT_GAUNTLET_PREFIX).toLowerCase();
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}-\\d{10,13}-[a-f0-9]{4,8}$`, "u");
  return re.test(slug.toLowerCase());
}

export function formatRunId(isoTimestamp: string, slug: string): string {
  const safeTs = isoTimestamp.replace(/[:.]/g, "-");
  return `${safeTs}-${slug}`;
}
