import { z } from "zod";

const envSchema = z.object({
  // --- Required ---
  FLUX_SYSTEM_DATABASE_URL: z.string().min(1),
  FLUX_GATEWAY_JWT_SECRET: z
    .string()
    .min(32, "FLUX_GATEWAY_JWT_SECRET must be at least 32 characters")
    .refine(
      (s) => s !== "REPLACE_THIS" && !s.startsWith("change-me"),
      "FLUX_GATEWAY_JWT_SECRET must not be the placeholder value from .env.example",
    ),
  FLUX_POSTGREST_POOL_URL: z.string().url(),
  /** Base domain for subdomain-slug fallback, e.g. `flux.localhost` or `flux.example.com`. */
  FLUX_BASE_DOMAIN: z.string().min(1),

  // --- Optional with defaults ---
  REDIS_URL: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(4000),
  FLUX_GATEWAY_RATE_LIMIT: z.coerce.number().int().positive().default(100),
  FLUX_GATEWAY_RATE_WINDOW_SEC: z.coerce.number().int().positive().default(60),
  FLUX_GATEWAY_JWT_TTL_SEC: z.coerce.number().int().positive().default(300),
  FLUX_POSTGREST_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
});

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[gateway] Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

export const env = parseEnv();
export type Env = typeof env;
