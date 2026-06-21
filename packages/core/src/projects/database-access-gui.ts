/**
 * Canonical GUI connection hints for private database access (CLI + dashboard).
 * Labels and field order live here so clients cannot drift.
 *
 * Browser-safe: no imports from database-access.ts (Docker/control-plane).
 */
import type { DatabaseAccessPlan } from "./database-access.ts";

export const DATABASE_GUI_LABELS = {
  connectionName: "Connection Name",
  type: "Type",
  host: "Host",
  port: "Port",
  user: "User",
  password: "Password",
  databaseName: "Database",
  tenantSchema: "Tenant schema",
  searchPath: "Search path",
  sslMode: "SSL",
  guiSshTunnel: "SSH tunnel (GUI)",
} as const;

export const V2_GUI_DATABASE_WARNING =
  "Do not use the temp username as the database name. Use database postgres.";

export const GUI_SSH_TUNNEL_OFF_VALUE =
  "off — Flux CLI already opened the SSH tunnel";

export type DatabaseGuiConnectionHints = {
  connectionName: string;
  type: "Postgres";
  host: string;
  port: number;
  user: string;
  passwordHint: string;
  databaseName: string;
  sslMode: string;
  tenantSchema?: string;
  searchPath?: string;
  guiSshTunnel: "off";
  guiSshTunnelNote: string;
  v2DatabaseWarning?: string;
  tunnelNote: string;
};

export type DatabaseGuiStructuredFields = {
  connectionName: string;
  type: "Postgres";
  host: string;
  port: number;
  user: string;
  passwordHint: string;
  databaseName: string;
  sslMode: string;
  tenantSchema?: string;
  searchPath?: string[];
  guiSshTunnel: "off";
  guiSshTunnelNote: string;
  v2DatabaseWarning?: string;
};

export type BuildDatabaseGuiConnectionHintsOptions = {
  username?: string;
  password?: string;
  tenantSchema?: string;
  searchPath?: string[];
};

function dbPasswordCommandHint(slug: string, hash: string): string {
  return `run \`flux db password ${slug} --hash ${hash}\``;
}

export function buildDatabaseGuiConnectionHints(
  plan: DatabaseAccessPlan,
  options: BuildDatabaseGuiConnectionHintsOptions = {},
): DatabaseGuiConnectionHints {
  const base = {
    connectionName: `${plan.projectName} via Flux`,
    type: "Postgres" as const,
    host: plan.tunnel.recommendedLocalHost,
    port: plan.tunnel.recommendedLocalPort,
    databaseName: plan.database.databaseName,
    sslMode: "disabled over tunnel",
    guiSshTunnel: "off" as const,
    guiSshTunnelNote: GUI_SSH_TUNNEL_OFF_VALUE,
    tunnelNote: "This only works while `flux db tunnel` is running.",
  };

  if (plan.mode === "v1_dedicated") {
    return {
      ...base,
      user: plan.database.username,
      passwordHint: dbPasswordCommandHint(plan.projectName, plan.projectHash),
    };
  }

  const tenantSchema = options.tenantSchema ?? plan.tenantSchema;
  const searchPath =
    options.searchPath ?? plan.database.searchPath;
  const user =
    options.username ??
    "temporary project-scoped role from `flux db tunnel`";
  const passwordHint =
    options.password ??
    "Created when you run `flux db tunnel` or `flux db gui-config --create-temp-credentials`. Never pooled admin credentials.";

  return {
    ...base,
    user,
    passwordHint,
    tenantSchema,
    searchPath: searchPath.join(", "),
    ...(options.username ? { v2DatabaseWarning: V2_GUI_DATABASE_WARNING } : {}),
  };
}

export function toDatabaseGuiStructuredFields(
  hints: DatabaseGuiConnectionHints,
): DatabaseGuiStructuredFields {
  return {
    connectionName: hints.connectionName,
    type: hints.type,
    host: hints.host,
    port: hints.port,
    user: hints.user,
    passwordHint: hints.passwordHint,
    databaseName: hints.databaseName,
    sslMode: hints.sslMode,
    ...(hints.tenantSchema ? { tenantSchema: hints.tenantSchema } : {}),
    ...(hints.searchPath
      ? { searchPath: hints.searchPath.split(", ") }
      : {}),
    guiSshTunnel: hints.guiSshTunnel,
    guiSshTunnelNote: hints.guiSshTunnelNote,
    ...(hints.v2DatabaseWarning
      ? { v2DatabaseWarning: hints.v2DatabaseWarning }
      : {}),
  };
}

export type DatabaseGuiConfigField = {
  label: string;
  value: string;
};

/** Ordered label/value pairs for dashboard copy blocks and CLI rendering. */
export function listDatabaseGuiConfigFields(
  hints: DatabaseGuiConnectionHints,
): DatabaseGuiConfigField[] {
  const fields: DatabaseGuiConfigField[] = [
    {
      label: DATABASE_GUI_LABELS.connectionName,
      value: hints.connectionName,
    },
    { label: DATABASE_GUI_LABELS.type, value: hints.type },
    { label: DATABASE_GUI_LABELS.host, value: hints.host },
    { label: DATABASE_GUI_LABELS.port, value: String(hints.port) },
    { label: DATABASE_GUI_LABELS.user, value: hints.user },
    { label: DATABASE_GUI_LABELS.password, value: hints.passwordHint },
    {
      label: DATABASE_GUI_LABELS.databaseName,
      value: hints.databaseName,
    },
  ];

  if (hints.v2DatabaseWarning) {
    fields.push({ label: "Note", value: hints.v2DatabaseWarning });
  }

  if (hints.tenantSchema) {
    fields.push({
      label: DATABASE_GUI_LABELS.tenantSchema,
      value: hints.tenantSchema,
    });
  }

  if (hints.searchPath) {
    fields.push({
      label: DATABASE_GUI_LABELS.searchPath,
      value: hints.searchPath,
    });
  }

  fields.push(
    { label: DATABASE_GUI_LABELS.sslMode, value: hints.sslMode },
    {
      label: DATABASE_GUI_LABELS.guiSshTunnel,
      value: hints.guiSshTunnelNote,
    },
  );

  return fields;
}

export function formatDatabaseGuiConfigLines(
  hints: DatabaseGuiConnectionHints,
): string[] {
  const lines = listDatabaseGuiConfigFields(hints).map(
    ({ label, value }) => `${label}: ${value}`,
  );
  lines.push("", hints.tunnelNote);
  return lines;
}

export function formatAccessPlanGuiSummary(plan: DatabaseAccessPlan): string[] {
  if (plan.mode !== "v2_shared") {
    return [];
  }

  return [
    `${DATABASE_GUI_LABELS.databaseName}: ${plan.database.databaseName}`,
    `${DATABASE_GUI_LABELS.tenantSchema}: ${plan.tenantSchema}`,
    `${DATABASE_GUI_LABELS.searchPath}: ${plan.database.searchPath.join(", ")}`,
    `${DATABASE_GUI_LABELS.guiSshTunnel}: off (CLI manages SSH)`,
  ];
}

export type DashboardDatabaseGuiInput = {
  slug: string;
  hash: string;
  mode: "v1_dedicated" | "v2_shared";
  tenantSchema?: string;
  localPort?: number;
};

/** Static dashboard preview (no live temp credentials). */
export function buildDashboardDatabaseGuiHints(
  input: DashboardDatabaseGuiInput,
): DatabaseGuiConnectionHints {
  const base = {
    connectionName: `${input.slug} via Flux`,
    type: "Postgres" as const,
    host: "127.0.0.1" as const,
    port: input.localPort ?? 15_432,
    databaseName: "postgres",
    sslMode: "disabled over tunnel",
    guiSshTunnel: "off" as const,
    guiSshTunnelNote: GUI_SSH_TUNNEL_OFF_VALUE,
    tunnelNote: "This only works while `flux db tunnel` is running.",
  };

  if (input.mode === "v1_dedicated") {
    return {
      ...base,
      user: "postgres",
      passwordHint: dbPasswordCommandHint(input.slug, input.hash),
    };
  }

  const tenantSchema = input.tenantSchema ?? "t_<shortId>_api";
  return {
    ...base,
    user: "temporary project-scoped role from `flux db tunnel`",
    passwordHint:
      "Created when you run `flux db tunnel`. Flux never exposes pooled admin credentials.",
    tenantSchema,
    searchPath: `${tenantSchema}, public`,
  };
}
