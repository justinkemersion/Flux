import { execFileSync } from "node:child_process";

/**
 * Ensures `FLUX_SHARED_POSTGRES_URL` is set before any migrate step touches the shared cluster.
 */
export function assertSharedPostgresUrlConfigured(): void {
  if (!process.env.FLUX_SHARED_POSTGRES_URL?.trim()) {
    throw new Error(
      "FLUX_SHARED_POSTGRES_URL is not set. Configure the shared Postgres URL used for v2 tenants.",
    );
  }
}

/**
 * Ensures `pg_dump` is on `PATH` so migration does not fail halfway through Docker work.
 */
export function assertPgDumpOnPath(): void {
  try {
    execFileSync("pg_dump", ["--version"], {
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch {
    throw new Error(
      "pg_dump not found on PATH. Install PostgreSQL client tools (e.g. postgresql-client) on the control plane host.",
    );
  }
}
