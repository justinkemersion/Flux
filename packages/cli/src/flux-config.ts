import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const FLUX_JSON = "flux.json" as const;

/** Foundry template placeholder until `flux init` runs. */
export const FLUX_INIT_PLACEHOLDER_HASH = "REPLACE_AFTER_FLUX_INIT" as const;

const fluxJsonSchema = z
  .object({
    slug: z.string().min(1, "slug must be a non-empty string"),
    hash: z
      .string()
      .regex(/^[a-f0-9]{7}$/i, { message: "hash must be 7 hex characters" }),
  })
  .strict();

export type FluxJson = z.infer<typeof fluxJsonSchema>;

export type FluxJsonRaw = Record<string, unknown> & {
  slug: string;
  hash: string;
};

const SECRET_KEYS = new Set([
  "jwt_secret",
  "jwtSecret",
  "projectJwtSecret",
  "pgrstJwtSecret",
  "FLUX_GATEWAY_JWT_SECRET",
]);

export function isFluxInitPlaceholderHash(hash: string): boolean {
  return hash.trim().toUpperCase() === FLUX_INIT_PLACEHOLDER_HASH;
}

function isValidProjectHash(hash: string): boolean {
  return /^[a-f0-9]{7}$/i.test(hash.trim());
}

function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}

function assertFluxJsonObject(parsed: unknown): Record<string, unknown> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("flux.json: root must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function readSlugFromRaw(raw: Record<string, unknown>): string {
  const slug = raw.slug;
  if (typeof slug !== "string" || !slug.trim()) {
    throw new Error('flux.json: "slug" must be a non-empty string.');
  }
  return slug.trim();
}

function readHashFromRaw(raw: Record<string, unknown>): string {
  const hash = raw.hash;
  if (typeof hash !== "string" || !hash.trim()) {
    throw new Error('flux.json: "hash" must be a non-empty string.');
  }
  return hash.trim();
}

function validateHashForRead(hash: string): void {
  if (isFluxInitPlaceholderHash(hash)) {
    throw new Error("flux.json: project not initialized. Run `flux init`.");
  }
  if (!isValidProjectHash(hash)) {
    throw new Error("flux.json: hash must be 7 hex characters.");
  }
}

async function readFluxJsonFile(cwd: string): Promise<{ path: string; raw: string } | null> {
  const path = join(cwd, FLUX_JSON);
  try {
    const raw = await readFile(path, "utf8");
    return { path, raw };
  } catch (e) {
    const code =
      e && typeof e === "object" && "code" in e
        ? (e as NodeJS.ErrnoException).code
        : undefined;
    if (code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Read `./flux.json` preserving unknown fields. Allows placeholder or 7-hex hash.
 */
export async function readFluxJsonRaw(cwd: string): Promise<FluxJsonRaw | null> {
  const file = await readFluxJsonFile(cwd);
  if (!file) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.raw) as unknown;
  } catch {
    throw new Error("flux.json: file is not valid JSON.");
  }
  const obj = assertFluxJsonObject(parsed);
  const slug = readSlugFromRaw(obj);
  const hash = readHashFromRaw(obj);
  if (!isFluxInitPlaceholderHash(hash) && !isValidProjectHash(hash)) {
    throw new Error(
      `flux.json: hash must be 7 hex characters or "${FLUX_INIT_PLACEHOLDER_HASH}".`,
    );
  }
  const normalizedHash = isFluxInitPlaceholderHash(hash)
    ? FLUX_INIT_PLACEHOLDER_HASH
    : hash.toLowerCase();
  return { ...obj, slug, hash: normalizedHash } as FluxJsonRaw;
}

export type FluxJsonInitPatch = {
  slug: string;
  hash: string;
  apiUrl?: string;
  mode?: "v1_dedicated" | "v2_shared";
  apiSchema?: string;
};

/**
 * Merge authoritative init fields into flux.json (never writes secrets).
 */
export async function writeFluxJson(cwd: string, patch: FluxJsonInitPatch): Promise<void> {
  const existing = (await readFluxJsonRaw(cwd)) ?? { slug: patch.slug, hash: patch.hash };
  const merged: Record<string, unknown> = { ...existing };
  merged.slug = patch.slug;
  merged.hash = patch.hash.toLowerCase();
  if (patch.apiUrl !== undefined) merged.apiUrl = patch.apiUrl;
  if (patch.mode !== undefined) merged.mode = patch.mode;
  if (patch.apiSchema !== undefined) merged.apiSchema = patch.apiSchema;
  for (const key of SECRET_KEYS) {
    delete merged[key];
  }
  const path = join(cwd, FLUX_JSON);
  await writeFile(path, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

/**
 * Read and validate `./flux.json` in `cwd`, or return null if the file is absent.
 * Rejects placeholder hash with a clear init message.
 */
export async function readFluxJson(cwd: string): Promise<FluxJson | null> {
  const raw = await readFluxJsonRaw(cwd);
  if (!raw) return null;
  validateHashForRead(raw.hash);
  const r = fluxJsonSchema.safeParse({ slug: raw.slug, hash: raw.hash });
  if (!r.success) {
    throw new Error(`flux.json: ${formatZodError(r.error)}`);
  }
  return { slug: r.data.slug, hash: r.data.hash.toLowerCase() };
}
