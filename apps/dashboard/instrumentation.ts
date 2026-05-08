/**
 * Runs once when the Next.js server starts (Node runtime only).
 * Provisions the flux-system Postgres project and creates the platform schema
 * tables so the first user sign-in never blocks on Docker provisioning.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { initSystemDb } = await import("./src/lib/db");
      await initSystemDb();
      console.log("[flux] System DB ready.");
      const { startFleetMonitor } = await import("./src/lib/fleet-monitor");
      startFleetMonitor();
      console.log("[flux] Fleet monitor started (2m interval).");
      const { startBackupScheduler } = await import("./src/lib/backup-scheduler");
      startBackupScheduler();
      console.log("[flux] Backup scheduler started (60m interval).");
      console.log("FLUX_CONTROL_PLANE: V1.0_STABLE_ONLINE");
    } catch (err) {
      console.error(
        "[flux] System DB initialisation failed — auth and project APIs will be unavailable until Docker is reachable:",
        err,
      );
    }
  }
}
