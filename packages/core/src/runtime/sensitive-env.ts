/**
 * Whether an env var name should not have its **value** printed (e.g. `flux env list`).
 * Heuristic: connection strings, JWT material, passwords, and typical secret/token names.
 */
export function isFluxSensitiveEnvKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (lower === "pgrst_db_uri" || lower === "pgrst_jwt_secret") return true;
  if (lower.includes("password") || lower.includes("passwd")) return true;
  if (lower.includes("secret") && !lower.includes("publishable")) return true;
  if (/_token$|_tokens$/i.test(key)) return true;
  if (lower.includes("private_key") || lower.includes("privatekey")) return true;
  if (/_api_key$/i.test(key) && !lower.includes("publishable")) return true;
  return false;
}
