import { slugifyProjectName } from "@flux/core/standalone";
import type { FluxJson } from "./flux-config";

/**
 * Resolves a project slug from a CLI value and/or `flux.json`.
 * @param flagHint e.g. `-p, --project` for error text
 */
export function resolveProjectSlug(
  fromCli: string | undefined,
  flux: FluxJson | null,
  flagHint: string,
): string {
  const raw = fromCli?.trim() || flux?.slug?.trim();
  if (!raw) {
    throw new Error(
      `Missing project. Pass ${flagHint} or add a "slug" field to flux.json in the current directory.`,
    );
  }
  return slugifyProjectName(raw);
}

/**
 * Resolves 7-hex project hash (CLI takes precedence, then `flux.json`).
 */
export function resolveHash(
  fromCli: string | undefined,
  flux: FluxJson | null,
): string {
  const h = (fromCli?.trim() || flux?.hash?.trim() || "").toLowerCase();
  if (!h) {
    throw new Error(
      'Missing project hash. Pass --hash <7hex> or add a "hash" field to flux.json.',
    );
  }
  if (!/^[a-f0-9]{7}$/i.test(h)) {
    throw new Error("Invalid project hash: expected 7 hex characters.");
  }
  return h.toLowerCase();
}

/** Optional: project name/slug for commands that can omit the positional if `flux.json` exists. */
export function resolveOptionalName(
  fromCli: string | undefined,
  flux: FluxJson | null,
  flagHint: string,
): string {
  const raw = fromCli?.trim() || flux?.slug?.trim();
  if (!raw) {
    throw new Error(
      `Missing project name. Pass a ${flagHint} or add a "slug" field to flux.json.`,
    );
  }
  return slugifyProjectName(raw);
}
