/**
 * Operators who see full CLI hints (npm notices, upgrade nags, yellow Notes).
 * Set on the control plane — not client-spoofable when using `flux login`.
 */
export type FluxCliRole = "admin" | "operator";

function parseCsvEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function resolveCliRoleForUser(input: {
  userId: string;
  email?: string | null;
  name?: string | null;
}): FluxCliRole {
  const adminIds = new Set(parseCsvEnv(process.env.FLUX_CLI_ADMIN_USER_IDS));
  if (adminIds.has(input.userId.trim())) {
    return "admin";
  }

  const adminEmails = new Set(
    parseCsvEnv(process.env.FLUX_CLI_ADMIN_EMAILS).map((e) => e.toLowerCase()),
  );
  if (adminEmails.size === 0) {
    return "operator";
  }

  const email = input.email?.trim().toLowerCase();
  if (email && adminEmails.has(email)) {
    return "admin";
  }

  const name = input.name?.trim().toLowerCase();
  if (name && adminEmails.has(name)) {
    return "admin";
  }

  return "operator";
}
