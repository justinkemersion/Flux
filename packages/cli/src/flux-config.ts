import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const FLUX_JSON = "flux.json" as const;

const fluxJsonSchema = z
  .object({
    slug: z.string().min(1, "slug must be a non-empty string"),
    hash: z
      .string()
      .regex(/^[a-f0-9]{7}$/i, { message: "hash must be 7 hex characters" }),
  })
  .strict();

export type FluxJson = z.infer<typeof fluxJsonSchema>;

function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}

/**
 * Read and validate `./flux.json` in `cwd`, or return null if the file is absent.
 * Invalid JSON or schema errors throw a deterministic, single-line prefix `flux.json:`.
 */
export async function readFluxJson(cwd: string): Promise<FluxJson | null> {
  const path = join(cwd, FLUX_JSON);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") return null;
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("flux.json: file is not valid JSON.");
  }
  const r = fluxJsonSchema.safeParse(parsed);
  if (!r.success) {
    throw new Error(`flux.json: ${formatZodError(r.error)}`);
  }
  return { slug: r.data.slug, hash: r.data.hash.toLowerCase() };
}
