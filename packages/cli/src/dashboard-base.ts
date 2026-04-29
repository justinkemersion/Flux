const DEFAULT_API_BASE = "https://flux.vsl-base.com/api";

/**
 * Origin of the Next.js dashboard (Mesh Readout). Override with
 * `FLUX_DASHBOARD_BASE`, or derive from `FLUX_API_BASE` by stripping a
 * trailing `/api` segment. Same fallback as the bundled CLI entrypoint.
 */
export function resolveDashboardBase(): string {
  const direct = process.env.FLUX_DASHBOARD_BASE?.trim();
  if (direct) {
    return direct.replace(/\/$/, "");
  }
  const raw = process.env.FLUX_API_BASE?.trim().replace(/\/$/, "");
  const api = raw && raw.length > 0 ? raw : DEFAULT_API_BASE;
  if (api.endsWith("/api")) {
    return api.slice(0, -"/api".length);
  }
  try {
    return new URL(api).origin;
  } catch {
    return "https://flux.vsl-base.com";
  }
}
