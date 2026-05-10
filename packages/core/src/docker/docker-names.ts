/** `flux-{hash}-{slug}` — base for `-db`, `-api`, Traefik router id, etc. */
export function fluxTenantStackBaseId(hash: string, slug: string): string {
  return `flux-${hash}-${slug}`;
}

/** Per-tenant isolated internal bridge for DB + API (Postgres only on this network; API also on the shared `flux-network` bridge). */
export function projectPrivateNetworkName(hash: string, slug: string): string {
  return `${fluxTenantStackBaseId(hash, slug)}-net`;
}

/**
 * The `flux-system` project hosts the control-plane DB; services on the shared flux bridge (e.g. the
 * dashboard) must be able to reach it via Docker DNS, while other tenants' Postgres must stay
 * off the shared bridge.
 */
export function isPlatformSystemStackSlug(slug: string): boolean {
  return slug === "flux-system";
}

export function postgresContainerName(hash: string, slug: string): string {
  return `${fluxTenantStackBaseId(hash, slug)}-db`;
}

export function postgrestContainerName(hash: string, slug: string): string {
  return `${fluxTenantStackBaseId(hash, slug)}-api`;
}

/** `flux-{hash}-{slug}-db-data` — Docker named volume for tenant PG data (used in deterministic password derivation). */
export function tenantVolumeName(hash: string, slug: string): string {
  return `${fluxTenantStackBaseId(hash, slug)}-db-data`;
}
