import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { projects } from "@/src/db/schema";
import type { SystemDb } from "@/src/lib/db";

export type V2TraefikTenant = {
  slug: string;
  hash: string;
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const HASH_RE = /^[a-f0-9]{7}$/u;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/u;

function assertSafeTenant(tenant: V2TraefikTenant): void {
  if (!SLUG_RE.test(tenant.slug)) {
    throw new Error(`Cannot render Traefik config for invalid slug: ${tenant.slug}`);
  }
  if (!HASH_RE.test(tenant.hash)) {
    throw new Error(`Cannot render Traefik config for invalid hash: ${tenant.hash}`);
  }
}

function assertSafeDomain(domain: string): void {
  if (!DOMAIN_RE.test(domain)) {
    throw new Error(`Cannot render Traefik config for invalid FLUX_DOMAIN: ${domain}`);
  }
}

/**
 * Build a Traefik file-provider document with one exact-host TLS router per
 * pooled tenant. Exact Host rules let Traefik discover every ACME certificate
 * name without restarting the shared gateway container.
 */
export function renderV2TraefikDynamicConfig(
  tenants: readonly V2TraefikTenant[],
  domain: string,
): string {
  const normalizedDomain = domain.trim().toLowerCase();
  assertSafeDomain(normalizedDomain);

  const routers: Record<string, unknown> = {};
  const sorted = [...tenants].sort((a, b) =>
    `${a.slug}:${a.hash}`.localeCompare(`${b.slug}:${b.hash}`),
  );
  for (const tenant of sorted) {
    assertSafeTenant(tenant);
    const hostname = `api--${tenant.slug}--${tenant.hash}.${normalizedDomain}`;
    routers[`flux-v2-tenant-${tenant.hash}`] = {
      rule: `Host(\`${hostname}\`)`,
      entryPoints: ["websecure"],
      priority: 100,
      service: "flux-v2-shared-gateway",
      tls: { certResolver: "myresolver" },
    };
  }

  return `${JSON.stringify(
    {
      http: {
        routers,
        services: {
          "flux-v2-shared-gateway": {
            loadBalancer: {
              servers: [{ url: "http://flux-node-gateway:4000" }],
            },
          },
        },
      },
    },
    null,
    2,
  )}\n`;
}

let syncQueue: Promise<void> = Promise.resolve();

async function writeCatalogConfig(
  db: SystemDb,
  configPath: string,
  domain: string,
): Promise<number> {
  const tenants = await db
    .select({ slug: projects.slug, hash: projects.hash })
    .from(projects)
    .where(eq(projects.mode, "v2_shared"));
  const document = renderV2TraefikDynamicConfig(tenants, domain);
  const directory = dirname(configPath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(
    directory,
    `.v2-tenants-${String(process.pid)}-${crypto.randomUUID()}.tmp`,
  );
  await writeFile(temporaryPath, document, { encoding: "utf8", mode: 0o644 });
  await rename(temporaryPath, configPath);
  return tenants.length;
}

/**
 * Reconcile the whole dynamic edge document from the authoritative catalog.
 * Calls are serialized so concurrent create/delete operations cannot publish a
 * stale snapshot after a newer one.
 *
 * The feature is intentionally inert unless the deployment supplies a path.
 */
export function syncV2TraefikDynamicConfig(db: SystemDb): Promise<number> {
  const configPath = process.env.FLUX_TRAEFIK_DYNAMIC_CONFIG_PATH?.trim();
  if (!configPath) return Promise.resolve(0);
  const domain = process.env.FLUX_DOMAIN?.trim() || "vsl-base.com";

  let count = 0;
  const next = syncQueue
    .catch(() => undefined)
    .then(async () => {
      count = await writeCatalogConfig(db, configPath, domain);
    });
  syncQueue = next;
  return next.then(() => count);
}

export async function syncV2TraefikDynamicConfigNonFatal(
  db: SystemDb,
  context: string,
): Promise<void> {
  try {
    const count = await syncV2TraefikDynamicConfig(db);
    if (process.env.FLUX_TRAEFIK_DYNAMIC_CONFIG_PATH?.trim()) {
      console.log(`[flux] Traefik v2 tenant config reconciled (${String(count)} tenants; ${context}).`);
    }
  } catch (err) {
    console.error(`[flux] Traefik v2 tenant config reconciliation failed (${context}):`, err);
  }
}
