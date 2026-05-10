import type { ApiClientContext } from "./context";
import { parseJsonResponseBody } from "./json-response";

export async function migrateV2ToV1(
  ctx: ApiClientContext,
  input: {
    slug: string;
    hash: string;
    dryRun?: boolean;
    yes?: boolean;
    staged?: boolean;
    dumpOnly?: boolean;
    preserveJwtSecret?: boolean;
    newJwtSecret?: boolean;
    lockWrites?: boolean;
    noLockWrites?: boolean;
    dropSourceAfter?: boolean;
  },
): Promise<unknown> {
  const token = ctx.tokenOrThrow();
  const url = `${ctx.baseUrl}/cli/v1/migrate`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      slug: input.slug.trim(),
      hash: input.hash.trim().toLowerCase(),
      dryRun: input.dryRun,
      yes: input.yes,
      staged: input.staged,
      dumpOnly: input.dumpOnly,
      preserveJwtSecret: input.preserveJwtSecret,
      newJwtSecret: input.newJwtSecret,
      lockWrites: input.lockWrites,
      noLockWrites: input.noLockWrites,
      dropSourceAfter: input.dropSourceAfter,
    }),
  });
  const text = await res.text();
  const body = parseJsonResponseBody(
    text,
    `flux migrate: response was not JSON (${String(res.status)}). Check FLUX_API_BASE.`,
  );
  if (!res.ok) {
    const obj = (body && typeof body === "object" ? body : {}) as Record<
      string,
      unknown
    >;
    const message =
      typeof obj.error === "string" && obj.error.trim()
        ? obj.error
        : `Request failed (${String(res.status)})`;
    throw new Error(message);
  }
  return body;
}
