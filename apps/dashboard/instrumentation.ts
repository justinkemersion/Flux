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
    } catch (err) {
      console.error(
        "[flux] System DB initialisation failed — auth and project APIs will be unavailable until Docker is reachable:",
        err,
      );
    }
  }
}
