import type {
  DatabaseAccessPlan,
  DedicatedDatabaseAccessPlan,
  PooledDatabaseAccessPlan,
} from "@flux/core/standalone";
import type { TemporaryDbCredential } from "../api-client/db-access";

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

export function dbPasswordCommand(slug: string, hash: string): string {
  return `flux db password ${slug} --hash ${hash}`;
}

export function formatV2DbPasswordRefusal(slug: string, hash: string): string {
  return (
    "v2_shared projects use temporary scoped credentials.\n" +
    `Run \`flux db tunnel ${slug} --hash ${hash}\` to create a temporary readonly credential.`
  );
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
      passwordBehavior: `run \`${dbPasswordCommand(plan.projectName, plan.projectHash)}\``,
    };
  }

  return {
    ...base,
    user: "temporary project-scoped role from `flux db tunnel`",
    passwordBehavior:
      "Created when you run `flux db tunnel` or `flux db gui-config --create-temp-credentials`. Never pooled admin credentials.",
    searchPath: plan.database.searchPath.join(", "),
  };
}

export function formatGuiConfigText(plan: DatabaseAccessPlan): string[] {
  const fields = buildGuiConfigFields(plan);
  return renderGuiConfigLines(fields);
}

export function formatGuiConfigTextWithCredential(
  plan: DatabaseAccessPlan,
  credential: TemporaryDbCredential,
): string[] {
  const fields = buildGuiConfigFields(plan);
  return renderGuiConfigLines({
    ...fields,
    user: credential.username,
    passwordBehavior: credential.password,
    searchPath: credential.searchPath.join(", "),
  });
}

function renderGuiConfigLines(fields: GuiConfigFields): string[] {
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
  return formatPooledAccessPlanSummary(plan);
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
    `Capabilities: tunnel=${String(plan.capabilities.tunnel)} guiConfig=${String(plan.capabilities.guiConfig)} restore=${String(plan.capabilities.restore)}`,
  ];
}

function formatPooledAccessPlanSummary(plan: PooledDatabaseAccessPlan): string[] {
  return [
    `Mode: v2_shared (pooled)`,
    `Project: ${plan.projectName}`,
    `Schema: ${plan.tenantSchema}`,
    `Supported: true`,
    `Local bind: ${plan.tunnel.recommendedLocalHost}:${String(plan.tunnel.recommendedLocalPort)}`,
    `Capabilities: tunnel=${String(plan.capabilities.tunnel)} shell=${String(plan.capabilities.shell)} dump=${String(plan.capabilities.dump)} restore=${String(plan.capabilities.restore)}`,
    ...plan.securityNotes.map((note) => `Note: ${note}`),
  ];
}
