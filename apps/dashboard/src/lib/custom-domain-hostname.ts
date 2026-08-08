import { fluxTenantDomain } from "@flux/core";

const FLUX_SUBDOMAIN_HASH_HEX_LEN = 7;

function normalizeHost(raw: string): string {
  return raw.toLowerCase().split(":")[0]!;
}

function fluxBaseDomains(): string[] {
  const domains = new Set<string>();
  const fromEnv = process.env.FLUX_BASE_DOMAIN?.trim().toLowerCase();
  if (fromEnv) domains.add(fromEnv);
  domains.add(fluxTenantDomain().toLowerCase());
  return [...domains];
}

/**
 * Returns true when `hostname` matches Flux-managed platform API host patterns
 * (api--slug--hash, api.slug.hash, legacy slug-hash) under a known base domain.
 */
export function isFluxManagedPlatformHostname(hostname: string): boolean {
  const host = normalizeHost(hostname);
  for (const baseDomain of fluxBaseDomains()) {
    if (host === baseDomain) return true;
    if (!host.endsWith(`.${baseDomain}`)) continue;

    const prefix = host.slice(0, host.length - baseDomain.length - 1);
    const parts = prefix.split(".");
    const hashHexRe = new RegExp(
      `^[0-9a-f]{${FLUX_SUBDOMAIN_HASH_HEX_LEN}}$`,
      "i",
    );

    if (parts.length === 1) {
      const label = parts[0] ?? "";
      if (label.toLowerCase().startsWith("api--")) {
        const segs = label.split("--");
        if (segs.length >= 3 && segs[0]!.toLowerCase() === "api") {
          const hashPart = segs[segs.length - 1]!.toLowerCase();
          if (hashHexRe.test(hashPart)) {
            const slug = segs.slice(1, -1).join("--");
            if (slug) return true;
          }
        }
      }
    }

    const dottedHash = parts[2]?.toLowerCase() ?? "";
    if (
      parts.length === 3 &&
      parts[0]!.toLowerCase() === "api" &&
      hashHexRe.test(dottedHash)
    ) {
      return true;
    }

    const label = parts[0] ?? "";
    const lastDash = label.lastIndexOf("-");
    if (lastDash > 0) {
      const slug = label.slice(0, lastDash);
      const hash = label.slice(lastDash + 1).toLowerCase();
      if (slug && hashHexRe.test(hash)) return true;
    }
  }
  return false;
}

const HOSTNAME_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/u;

export function validateCustomDomainHostname(
  rawHostname: string,
): { ok: true; hostname: string } | { ok: false; error: string } {
  const hostname = normalizeHost(rawHostname.trim());
  if (!hostname || hostname.includes("..") || hostname.startsWith(".")) {
    return { ok: false, error: "hostname is invalid." };
  }
  if (!HOSTNAME_RE.test(hostname)) {
    return { ok: false, error: "hostname is invalid." };
  }
  if (isFluxManagedPlatformHostname(hostname)) {
    return {
      ok: false,
      error:
        "Cannot claim Flux-managed platform hostnames (api--slug--hash or legacy API subdomains).",
    };
  }
  return { ok: true, hostname };
}
