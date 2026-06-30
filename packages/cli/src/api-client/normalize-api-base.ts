/**
 * Normalize `FLUX_API_BASE` to the control-plane API origin (`…/api`).
 * Accepts both `https://flux.vsl-base.com` and `https://flux.vsl-base.com/api`.
 */

export function normalizeFluxApiBase(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("FLUX_API_BASE must be a non-empty URL.");
  }

  let base = trimmed.replace(/\/+$/, "");

  while (/\/api$/i.test(base)) {
    const without = base.replace(/\/api$/i, "");
    if (!/\/api$/i.test(without)) {
      break;
    }
    base = without;
  }

  if (!/\/api$/i.test(base)) {
    base = `${base}/api`;
  }

  return base;
}
