import type {
  DatabaseAccessPlan,
  DedicatedDatabaseAccessPlan,
  PooledDatabaseAccessPreviewPlan,
} from "@flux/core";

export function dbTunnelCommand(slug: string, hash: string): string {
  return `flux db tunnel ${slug} --hash ${hash}`;
}

export function dbShellCommand(slug: string, hash: string): string {
  return `flux db shell ${slug} --hash ${hash}`;
}

export function dbDumpCommand(slug: string, hash: string): string {
  return `flux db dump ${slug} --hash ${hash} --output ${slug}.dump`;
}

export function dbGuiConfigCommand(slug: string, hash: string): string {
  return `flux db gui-config ${slug} --hash ${hash}`;
}

export function dbAccessPlanCommand(slug: string, hash: string): string {
  return `flux db access-plan ${slug} --hash ${hash}`;
}

export function projectCredentialsCommand(slug: string, hash: string): string {
  return `flux project credentials ${slug} --hash ${hash}`;
}

export type GuiConfigFields = {
  connectionName: string;
  type: "Postgres";
  host: string;
  port: number;
  user: string;
  passwordBehavior: string;
  database: string;
  sslMode: string;
  searchPath?: string;
  tunnelNote: string;
};

export function buildGuiConfigFields(plan: DatabaseAccessPlan): GuiConfigFields {
  const base = {
    connectionName: `${plan.projectName} via Flux`,
    type: "Postgres" as const,
    host: plan.tunnel.recommendedLocalHost,
    port: plan.tunnel.recommendedLocalPort,
    database: "postgres",
    sslMode: "disabled over tunnel",
    tunnelNote: "This only works while `flux db tunnel` is running.",
  };

  if (plan.mode === "v1_dedicated") {
    return {
      ...base,
      user: plan.database.username,
      passwordBehavior: projectCredentialsCommand(plan.projectName, plan.projectHash),
    };
  }

  return {
    ...base,
    user: "temporary role created by `flux db tunnel` (Pass 2)",
    passwordBehavior:
      "Scoped temporary credentials are coming in Pass 2. No pooled admin credentials are exposed.",
    searchPath: plan.database.searchPath.join(", "),
  };
}

export function formatGuiConfigText(plan: DatabaseAccessPlan): string[] {
  const fields = buildGuiConfigFields(plan);
  const lines = [
    `Connection Name: ${fields.connectionName}`,
    `Type: ${fields.type}`,
    `Host: ${fields.host}`,
    `Port: ${String(fields.port)}`,
    `User: ${fields.user}`,
    `Password: ${fields.passwordBehavior}`,
    `Database: ${fields.database}`,
    `SSL: ${fields.sslMode}`,
  ];
  if (fields.searchPath) {
    lines.push(`Search path: ${fields.searchPath}`);
  }
  lines.push("", fields.tunnelNote);
  return lines;
}

export function formatAccessPlanSummary(plan: DatabaseAccessPlan): string[] {
  if (plan.mode === "v1_dedicated") {
    return formatDedicatedAccessPlanSummary(plan);
  }
  return formatPooledPreviewSummary(plan);
}

function formatDedicatedAccessPlanSummary(plan: DedicatedDatabaseAccessPlan): string[] {
  return [
    `Mode: v1_dedicated`,
    `Project: ${plan.projectName}`,
    `Scope: dedicated database`,
    `Internal host: ${plan.database.internalHost}`,
    `Container: ${plan.database.containerName}`,
    `Local bind: ${plan.tunnel.recommendedLocalHost}:${String(plan.tunnel.recommendedLocalPort)}`,
    `SSH: ${plan.tunnel.sshUser}@${plan.tunnel.sshHost || "(configure FLUX_DB_TUNNEL_SSH_HOST)"}:${String(plan.tunnel.sshPort)}`,
    `Capabilities: tunnel=${String(plan.capabilities.tunnel)} guiConfig=${String(plan.capabilities.guiConfig)}`,
  ];
}

function formatPooledPreviewSummary(plan: PooledDatabaseAccessPreviewPlan): string[] {
  return [
    `Mode: v2_shared (pooled)`,
    `Project: ${plan.projectName}`,
    `Schema: ${plan.tenantSchema}`,
    `Supported: false (preview)`,
    plan.previewMessage,
    ...plan.securityNotes.map((note) => `Note: ${note}`),
  ];
}
