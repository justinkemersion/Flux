export function dbTunnelCommand(slug: string, hash: string): string {
  return `flux db tunnel ${slug} --hash ${hash}`;
}

export function dbShellCommand(slug: string, hash: string): string {
  return `flux db shell ${slug} --hash ${hash}`;
}

export function dbDumpCommand(slug: string, hash: string, mode: "v1_dedicated" | "v2_shared"): string {
  if (mode === "v2_shared") {
    return `flux db dump ${slug} --hash ${hash} --schema-only --output ${slug}.schema.dump`;
  }
  return `flux backup create ${slug} --hash ${hash}`;
}

export function dbGuiConfigCommand(slug: string, hash: string): string {
  return `flux db gui-config ${slug} --hash ${hash}`;
}

export type DashboardDbAccessCopyInput = {
  slug: string;
  hash: string;
  mode: "v1_dedicated" | "v2_shared";
  tenantSchema?: string;
};

export {
  buildDashboardDatabaseGuiHints as buildGuiConfigFields,
  listDatabaseGuiConfigFields,
  type DatabaseGuiConfigField,
  type DatabaseGuiConnectionHints,
} from "@flux/core";

export function privateDbAccessIntro(mode: "v1_dedicated" | "v2_shared"): string {
  if (mode === "v2_shared") {
    return (
      "Postgres is not exposed publicly. Run `flux db tunnel` to open a local SSH tunnel and " +
      "receive temporary project-scoped credentials for your tenant schema."
    );
  }
  return (
    "Postgres is not exposed publicly. Use the Flux CLI to open a temporary local tunnel, " +
    "then connect your SQL viewer to localhost."
  );
}
