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

export type DashboardGuiConfigCopy = {
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

export function buildGuiConfigFields(
  input: DashboardDbAccessCopyInput,
): DashboardGuiConfigCopy {
  const base = {
    connectionName: `${input.slug} via Flux`,
    type: "Postgres" as const,
    host: "127.0.0.1",
    port: 15432,
    database: "postgres",
    sslMode: "disabled over tunnel",
    tunnelNote: "This only works while `flux db tunnel` is running.",
  };

  if (input.mode === "v1_dedicated") {
    return {
      ...base,
      user: "postgres",
      passwordBehavior: `run \`flux project credentials ${input.slug} --hash ${input.hash}\``,
    };
  }

  return {
    ...base,
    user: "temporary project-scoped role from `flux db tunnel`",
    passwordBehavior:
      "Created when you run `flux db tunnel`. Flux never exposes pooled admin credentials.",
    searchPath: input.tenantSchema
      ? `${input.tenantSchema}, public`
      : "tenant schema, public",
  };
}

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
