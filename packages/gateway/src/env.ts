import { config as loadDotEnv } from "dotenv";
import { join } from "node:path";
import { z } from "zod";

// Load packages/gateway/.env when present (repo root usage). Does not override
// vars already set (systemd, Docker, shell exports win).
loadDotEnv({ path: join(process.cwd(), "packages/gateway/.env") });

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
  FLUX_GATEWAY_SOCKET_TIMEOUT_MS: z.coerce.number().int().positive().default(9000),
  FLUX_GATEWAY_MAX_INFLIGHT: z.coerce.number().int().positive().default(1000),
  FLUX_GATEWAY_ADAPTIVE_INFLIGHT: z
    .union([z.literal("0"), z.literal("1")])
    .default("0")
    .transform((v) => v === "1"),
  FLUX_GATEWAY_ADAPTIVE_MIN_INFLIGHT: z.coerce.number().int().positive().default(100),
  FLUX_GATEWAY_ADAPTIVE_HARD_MAX_INFLIGHT: z.coerce.number().int().positive().default(2000),
  FLUX_GATEWAY_ADAPTIVE_TARGET_P95_MS: z.coerce.number().int().positive().default(500),
  FLUX_GATEWAY_ADAPTIVE_UP_STEP: z.coerce.number().int().positive().default(50),
  FLUX_GATEWAY_ADAPTIVE_DOWN_FACTOR: z.coerce.number().positive().max(0.99).default(0.9),
  FLUX_GATEWAY_ADAPTIVE_SAMPLE_SIZE: z.coerce.number().int().positive().default(200),
  FLUX_GATEWAY_ADAPTIVE_TICK_MS: z.coerce.number().int().positive().default(1000),
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
