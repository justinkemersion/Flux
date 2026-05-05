const FLUX_SUBDOMAIN_HASH_HEX_LEN = 7;

/** Parsed Flux-managed subdomain under FLUX_BASE_DOMAIN (no DB / env I/O). */
export type ParsedFluxSubdomain =
  | { kind: "flat"; slug: string; hash: string }
  | { kind: "dotted"; slug: string; hash: string }
  | { kind: "legacySlugHash"; slug: string; hash: string };

/**
 * Parses `host` when it is a subdomain of `baseDomain` into slug/hash for catalog lookup.
 * `host` should already be normalised (lowercase, no port); `baseDomain` is compared lowercase.
 */
export function parseFluxSubdomain(
  host: string,
  baseDomain: string,
): ParsedFluxSubdomain | null {
  const h = host.toLowerCase();
  const b = baseDomain.toLowerCase();
  if (h === b || !h.endsWith(`.${b}`)) {
    return null;
  }

  const prefix = h.slice(0, h.length - b.length - 1);
  const parts = prefix.split(".");
  const hashHexRe = new RegExp(
    `^[0-9a-f]{${FLUX_SUBDOMAIN_HASH_HEX_LEN}}$`,
    "i",
  );

  // 4a-flat. Single label: api--<slug>--<hash>.<base>
  if (parts.length === 1) {
    const label = parts[0] ?? "";
    if (label.toLowerCase().startsWith("api--")) {
      const segs = label.split("--");
      if (segs.length >= 3 && segs[0]!.toLowerCase() === "api") {
        const hashPart = segs[segs.length - 1]!.toLowerCase();
        if (hashHexRe.test(hashPart)) {
          const slug = segs.slice(1, -1).join("--");
          if (slug) {
            return { kind: "flat", slug, hash: hashPart };
          }
        }
      }
    }
  }

  // 4b-dot. api.<slug>.<hash>.<base>
  const dottedHash = parts[2]?.toLowerCase() ?? "";
  if (
    parts.length === 3 &&
    parts[0]!.toLowerCase() === "api" &&
    hashHexRe.test(dottedHash)
  ) {
    return { kind: "dotted", slug: parts[1]!, hash: dottedHash };
  }

  // 4c. Legacy single-label: <slug>-<hash>.<base>
  const label = parts[0] ?? "";
  const lastDash = label.lastIndexOf("-");
  if (lastDash > 0) {
    const slug = label.slice(0, lastDash);
    const hash = label.slice(lastDash + 1).toLowerCase();
    if (slug && hash) {
      return { kind: "legacySlugHash", slug, hash };
    }
  }

  return null;
}
