export const POSTGRES_CREDENTIAL_FIELDS = [
  "postgres.user",
  "postgres.password",
  "postgres.database",
  "postgres.host",
  "postgres.port",
  "postgres.url",
] as const;

export type PostgresCredentialField = (typeof POSTGRES_CREDENTIAL_FIELDS)[number];

export type PostgresConnectionFields = {
  user: string;
  password: string;
  database: string;
  host: string;
  port: number;
  url: string;
};

export function parsePostgresConnectionFields(
  connectionString: string,
): PostgresConnectionFields {
  const normalized = connectionString.startsWith("postgres://")
    ? `postgresql://${connectionString.slice("postgres://".length)}`
    : connectionString;
  const url = new URL(normalized);
  const port = url.port ? Number.parseInt(url.port, 10) : 5432;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("Postgres connection string has an invalid port.");
  }
  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, "") || "postgres",
    host: url.hostname,
    port,
    url: connectionString,
  };
}

export function parsePostgresPasswordFromConnectionString(
  connectionString: string,
): string {
  return parsePostgresConnectionFields(connectionString).password;
}

export function resolvePostgresCredentialField(
  fields: PostgresConnectionFields,
  field: string,
): string {
  const normalized = field.trim();
  switch (normalized) {
    case "postgres.user":
      return fields.user;
    case "postgres.password":
      return fields.password;
    case "postgres.database":
      return fields.database;
    case "postgres.host":
      return fields.host;
    case "postgres.port":
      return String(fields.port);
    case "postgres.url":
      return fields.url;
    default:
      throw new Error(
        `Unsupported credential field "${field}". Supported fields: ${POSTGRES_CREDENTIAL_FIELDS.join(", ")}.`,
      );
  }
}

export function unsupportedPostgresFieldForV2Message(): string {
  return (
    "v2_shared projects do not expose Postgres credentials. " +
    `Supported fields apply to v1_dedicated only: ${POSTGRES_CREDENTIAL_FIELDS.join(", ")}.`
  );
}

const SECTION_RULE = "────────────────────────";

export function buildV1PostgresCredentialSectionLines(
  fields: PostgresConnectionFields,
): string[] {
  return [
    "Postgres",
    SECTION_RULE,
    `User:      ${fields.user}`,
    `Password:  ${fields.password}`,
    `Database:  ${fields.database}`,
    `Host:      ${fields.host}`,
    `Port:      ${String(fields.port)}`,
    "",
    "Connection URL",
    SECTION_RULE,
    fields.url,
  ];
}
