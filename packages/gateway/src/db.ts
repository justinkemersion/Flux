import pg from "pg";
import { env } from "./env.ts";

const { Pool } = pg;

let _pool: pg.Pool | null = null;

/**
 * Returns the shared pg.Pool for flux-system read-only queries.
 * No Docker, no initSystemDb — connects directly via FLUX_SYSTEM_DATABASE_URL.
 */
export function getPool(): pg.Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: env.FLUX_SYSTEM_DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    _pool.on("error", (err) => {
      console.error("[gateway:db] pool error:", err.message);
    });
  }
  return _pool;
}

/** Lightweight DB connectivity check — used by /health. */
export async function pingDb(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
