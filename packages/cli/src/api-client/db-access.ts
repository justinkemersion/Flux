import {
  FLUX_PROJECT_HASH_HEX_LEN,
  type DbAccessLevel,
} from "@flux/core";
import type { DatabaseAccessPlan } from "@flux/core";
import { z } from "zod";
import type { ApiClientContext } from "./context";
import {
  errorMessageFromJsonBody,
  parseJsonResponseBody,
} from "./json-response";

const databaseAccessCapabilitiesSchema = z.object({
  tunnel: z.boolean(),
  guiConfig: z.boolean(),
  shell: z.boolean(),
  dump: z.boolean(),
  restore: z.boolean(),
  readonly: z.boolean(),
  readwrite: z.boolean(),
  temporaryCredentials: z.boolean(),
});

const tunnelDefaultsSchema = z.object({
  sshHost: z.string(),
  sshUser: z.string(),
  sshPort: z.number(),
  recommendedLocalHost: z.literal("127.0.0.1"),
  recommendedLocalPort: z.number(),
});

const dedicatedPlanSchema = z.object({
  mode: z.literal("v1_dedicated"),
  supported: z.literal(true),
  projectName: z.string(),
  projectHash: z.string(),
  engine: z.literal("postgres"),
  transport: z.literal("ssh_tunnel"),
  scope: z.literal("whole_database"),
  database: z.object({
    databaseName: z.literal("postgres"),
    username: z.string(),
    internalHost: z.string(),
    internalPort: z.number(),
    containerName: z.string(),
    dockerNetworkName: z.string(),
    sslMode: z.literal("disable"),
  }),
  tunnel: tunnelDefaultsSchema,
  credentialStrategy: z.enum([
    "project_postgres_password",
    "readonly_project_password",
  ]),
  capabilities: databaseAccessCapabilitiesSchema,
});

const pooledPlanSchema = z.object({
  mode: z.literal("v2_shared"),
  supported: z.literal(true),
  projectName: z.string(),
  projectHash: z.string(),
  engine: z.literal("postgres"),
  transport: z.literal("ssh_tunnel"),
  scope: z.literal("tenant_schema"),
  tenantSchema: z.string(),
  database: z.object({
    databaseName: z.literal("postgres"),
    internalHost: z.string(),
    internalPort: z.number(),
    containerName: z.string().optional(),
    sslMode: z.literal("disable"),
    searchPath: z.array(z.string()),
  }),
  tunnel: tunnelDefaultsSchema,
  credentialStrategy: z.literal("temporary_project_scoped_role"),
  defaultAccess: z.literal("readonly"),
  securityNotes: z.array(z.string()),
  capabilities: databaseAccessCapabilitiesSchema,
});

export const databaseAccessPlanSchema = z.discriminatedUnion("mode", [
  dedicatedPlanSchema,
  pooledPlanSchema,
]);

export const temporaryDbCredentialSchema = z.object({
  username: z.string(),
  password: z.string(),
  access: z.enum(["readonly", "readwrite"]),
  expiresAt: z.string(),
  tenantSchema: z.string(),
  searchPath: z.array(z.string()),
});

export type TemporaryDbCredential = z.infer<typeof temporaryDbCredentialSchema>;

export function parseDatabaseAccessPlan(raw: unknown): DatabaseAccessPlan {
  const parsed = databaseAccessPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      "CLI db-access: response did not match expected access plan shape.",
    );
  }
  return parsed.data as DatabaseAccessPlan;
}

export function parseTemporaryDbCredential(raw: unknown): TemporaryDbCredential {
  const parsed = temporaryDbCredentialSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      "CLI db-access: temporary credential response did not match expected shape.",
    );
  }
  return parsed.data;
}

export async function getProjectDbAccessPlan(
  ctx: ApiClientContext,
  hash: string,
  options?: {
    localPort?: number;
    sshHost?: string;
    sshUser?: string;
    sshPort?: number;
  },
): Promise<DatabaseAccessPlan> {
  const token = ctx.tokenOrThrow();
  const h = hash.trim().toLowerCase();
  if (h.length !== FLUX_PROJECT_HASH_HEX_LEN || !/^[a-f0-9]+$/u.test(h)) {
    throw new Error(
      `Project hash must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-character lowercase hex id.`,
    );
  }
  const url = new URL(
    `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(h)}/db-access`,
  );
  if (options?.localPort != null) {
    url.searchParams.set("localPort", String(options.localPort));
  }
  if (options?.sshHost) url.searchParams.set("sshHost", options.sshHost);
  if (options?.sshUser) url.searchParams.set("sshUser", options.sshUser);
  if (options?.sshPort != null) {
    url.searchParams.set("sshPort", String(options.sshPort));
  }
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  const raw = parseJsonResponseBody(
    text,
    `CLI db-access: response was not JSON (${res.status}). Check FLUX_API_BASE.`,
  );
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(raw, res.status));
  }
  return parseDatabaseAccessPlan(raw);
}

export async function createTemporaryProjectDbCredential(
  ctx: ApiClientContext,
  hash: string,
  options?: {
    access?: DbAccessLevel;
    ttlSeconds?: number;
  },
): Promise<TemporaryDbCredential> {
  const token = ctx.tokenOrThrow();
  const h = hash.trim().toLowerCase();
  if (h.length !== FLUX_PROJECT_HASH_HEX_LEN || !/^[a-f0-9]+$/u.test(h)) {
    throw new Error(
      `Project hash must be a ${String(FLUX_PROJECT_HASH_HEX_LEN)}-character lowercase hex id.`,
    );
  }
  const url = `${ctx.baseUrl}/cli/v1/projects/${encodeURIComponent(h)}/db-access/temporary-credential`;
  const body: { access?: DbAccessLevel; ttlSeconds?: number } = {};
  if (options?.access) body.access = options.access;
  if (options?.ttlSeconds != null) body.ttlSeconds = options.ttlSeconds;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const raw = parseJsonResponseBody(
    text,
    `CLI db-access: temporary credential response was not JSON (${res.status}).`,
  );
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  if (!res.ok) {
    throw new Error(errorMessageFromJsonBody(raw, res.status));
  }
  return parseTemporaryDbCredential(raw);
}
