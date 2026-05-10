import { createHmac } from "node:crypto";
import { slugifyProjectName } from "../standalone.ts";
import { tenantVolumeName } from "../docker/docker-names.ts";

function deterministicPostgresPasswordFromDevSecret(
  secret: string,
  volumeName: string,
): string {
  return createHmac("sha256", secret)
    .update(volumeName, "utf8")
    .digest("hex")
    .slice(0, 32);
}

/**
 * Deterministic HMAC-SHA256 PostgreSQL superuser password for a tenant, matching
 * `FLUX_DEV_POSTGRES_PASSWORD` / `FLUX_PROJECT_PASSWORD_SECRET` at provision time (same bytes as
 * `deterministicPostgresPasswordFromDevSecret` for {@link tenantVolumeName} of this `(hash, slug)`).
 */
export function deriveTenantPostgresPasswordFromSecret(
  secret: string,
  hash: string,
  slugOrName: string,
): string {
  const slug = slugifyProjectName(slugOrName);
  return deterministicPostgresPasswordFromDevSecret(
    secret.trim(),
    tenantVolumeName(hash, slug),
  );
}
