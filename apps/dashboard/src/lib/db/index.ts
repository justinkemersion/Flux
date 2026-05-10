import { FLUX_SYSTEM_HASH } from "@flux/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../db/schema";
import { getProjectManager } from "../flux";
import {
  loopbackTargetFromPostgresUrl,
  resolveSystemDatabaseConnectionString,
  waitForTcpPort,
} from "./connection";
import { runSystemDbBootstrap } from "./system-db-bootstrap";

export type SystemDb = ReturnType<typeof drizzle<typeof schema>>;

let db: SystemDb | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Idempotent — returns the same promise on concurrent calls.
 * Provisions the flux-system project (Postgres + PostgREST), connects,
 * and creates the platform schema tables.
 */
export function initSystemDb(): Promise<void> {
  if (!initPromise) {
    initPromise = _init().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function _init(): Promise<void> {
  const pm = getProjectManager();

  try {
    await pm.provisionProject(
      "flux-system",
      { isProduction: process.env.NODE_ENV === "production" },
      FLUX_SYSTEM_HASH,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already exists")) throw err;
    try {
      await pm.startProject("flux-system", FLUX_SYSTEM_HASH);
    } catch {
      // 304: already running — safe to ignore
    }
  }

  const connectionString = await resolveSystemDatabaseConnectionString(
    pm,
    FLUX_SYSTEM_HASH,
  );
  const loopback = loopbackTargetFromPostgresUrl(connectionString);
  if (loopback) {
    await waitForTcpPort(loopback.host, loopback.port, 60_000);
  }
  const pool = new Pool({ connectionString });

  await runSystemDbBootstrap(pool);

  db = drizzle(pool, { schema });
}

/** Synchronous getter — throws if {@link initSystemDb} has not been awaited. */
export function getDb(): SystemDb {
  if (!db) {
    throw new Error(
      "[flux] System DB not initialised. Ensure initSystemDb() is awaited first.",
    );
  }
  return db;
}
