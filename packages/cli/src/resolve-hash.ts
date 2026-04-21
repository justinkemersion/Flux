import { ProjectManager, slugifyProjectName } from "@flux/core";

/** CLI env var scoping the slug→hash lookup to a single dashboard user (Auth.js `user.id`). */
export function fluxCliOwnerKey(): string | undefined {
  const v = process.env.FLUX_OWNER_KEY?.trim();
  return v && v.length > 0 ? v : undefined;
}

/**
 * Resolves a project `slug` to its per-project `hash` for locating Docker containers and Traefik
 * labels. Precedence:
 *
 * 1. `cliHash` (from the `--hash <hex>` CLI flag) when provided — no DB round-trip.
 * 2. `flux-system` catalog row matched by `(slug, userId?)` via `ProjectManager.lookupProjectHashBySlug`.
 *
 * When neither yields a value, throws a clear error pointing the operator at `--hash`. The
 * fallback is important for disaster-recovery scenarios where `flux-system` itself is down.
 */
export async function resolveProjectHash(
  pm: ProjectManager,
  slug: string,
  cliHash: string | undefined,
): Promise<string> {
  const trimmed = cliHash?.trim();
  if (trimmed && trimmed.length > 0) return trimmed;

  const normalized = slugifyProjectName(slug);
  const ownerKey = fluxCliOwnerKey();
  try {
    const hash = await pm.lookupProjectHashBySlug(normalized, ownerKey);
    if (hash) return hash;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not resolve hash for project "${normalized}" from flux-system (${msg}). ` +
        `Pass --hash <7hex> to override.`,
    );
  }
  throw new Error(
    `No flux-system catalog row found for project "${normalized}"` +
      (ownerKey ? ` under FLUX_OWNER_KEY` : "") +
      `. Pass --hash <7hex> to override, or run "flux list" to see available stacks.`,
  );
}
