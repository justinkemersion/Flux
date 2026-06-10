/** Public read-only demo session for the Flux control plane (see docker/web/.env.example). */

export function isDemoEnabled(): boolean {
  return (
    process.env.FLUX_DEMO_ENABLED === "1" &&
    Boolean(process.env.FLUX_DEMO_USER_ID?.trim()) &&
    Boolean(process.env.FLUX_DEMO_INTERNAL_KEY?.trim())
  );
}

export function demoUserId(): string | null {
  const id = process.env.FLUX_DEMO_USER_ID?.trim();
  return id || null;
}
