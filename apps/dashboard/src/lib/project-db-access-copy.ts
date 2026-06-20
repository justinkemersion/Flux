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
    user: "temporary role created by `flux db tunnel` (Pass 2)",
    passwordBehavior:
      "Scoped temporary credentials are coming in Pass 2. No pooled admin credentials are exposed.",
    searchPath: input.tenantSchema
      ? `${input.tenantSchema}, public`
      : "tenant schema, public",
  };
}

export function privateDbAccessIntro(mode: "v1_dedicated" | "v2_shared"): string {
  if (mode === "v2_shared") {
    return (
      "Postgres is not exposed publicly. Pooled projects will use temporary project-scoped " +
      "credentials through the Flux CLI in Pass 2. Until then, inspect the preview access plan " +
      "with `flux db access-plan`."
    );
  }
  return (
    "Postgres is not exposed publicly. Use the Flux CLI to open a temporary local tunnel, " +
    "then connect your SQL viewer to localhost."
  );
}
