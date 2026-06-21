import type {
  DatabaseAccessPlan,
  DedicatedDatabaseAccessPlan,
  PooledDatabaseAccessPlan,
} from "@flux/core/standalone";
import {
  buildDatabaseGuiConnectionHints,
  formatAccessPlanGuiSummary,
  formatDatabaseGuiConfigLines,
  toDatabaseGuiStructuredFields,
  type DatabaseGuiConnectionHints,
  type DatabaseGuiStructuredFields,
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

/** @deprecated Use buildDatabaseGuiConnectionHints from @flux/core */
export type GuiConfigFields = DatabaseGuiConnectionHints & {
  passwordBehavior: string;
  database: string;
};

export function buildGuiConfigFields(plan: DatabaseAccessPlan): DatabaseGuiConnectionHints {
  return buildDatabaseGuiConnectionHints(plan);
}

export function buildGuiStructuredFields(
  plan: DatabaseAccessPlan,
  credential?: TemporaryDbCredential,
): DatabaseGuiStructuredFields {
  return toDatabaseGuiStructuredFields(
    credential
      ? buildDatabaseGuiConnectionHints(plan, {
          username: credential.username,
          password: credential.password,
          tenantSchema: credential.tenantSchema,
          searchPath: credential.searchPath,
        })
      : buildDatabaseGuiConnectionHints(plan),
  );
}

export function formatGuiConfigText(plan: DatabaseAccessPlan): string[] {
  return formatDatabaseGuiConfigLines(buildDatabaseGuiConnectionHints(plan));
}

export function formatGuiConfigTextWithCredential(
  plan: DatabaseAccessPlan,
  credential: TemporaryDbCredential,
): string[] {
  return formatDatabaseGuiConfigLines(
    buildDatabaseGuiConnectionHints(plan, {
      username: credential.username,
      password: credential.password,
      tenantSchema: credential.tenantSchema,
      searchPath: credential.searchPath,
    }),
  );
}

export function formatAccessPlanSummary(plan: DatabaseAccessPlan): string[] {
  if (plan.mode === "v1_dedicated") {
    return formatDedicatedAccessPlanSummary(plan);
  }
  return [
    ...formatPooledAccessPlanSummary(plan),
    ...formatAccessPlanGuiSummary(plan),
  ];
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
