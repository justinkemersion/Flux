import { isSensitiveEnvName } from "./redact.ts";

export type OffsiteStorageConfig = {
  enabled: true;
  strict: boolean;
  bucket: string;
  prefix: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function parseOffsiteStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): OffsiteStorageConfig | null {
  const envTruthyLocal = (name: string): boolean => {
    const v = env[name]?.trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes";
  };
  const readEnvLocal = (name: string): string | undefined => {
    const v = env[name]?.trim();
    return v && v.length > 0 ? v : undefined;
  };

  if (!envTruthyLocal("FLUX_R2_BACKUPS_ENABLED")) {
    return null;
  }

  const bucket = readEnvLocal("FLUX_R2_BACKUP_BUCKET");
  const prefix = readEnvLocal("FLUX_R2_BACKUP_PREFIX");
  const endpoint = readEnvLocal("FLUX_R2_ENDPOINT");
  const region = readEnvLocal("FLUX_R2_REGION") ?? "auto";
  const accessKeyId = readEnvLocal("FLUX_R2_ACCESS_KEY_ID");
  const secretAccessKey = readEnvLocal("FLUX_R2_SECRET_ACCESS_KEY");

  if (!bucket || !prefix || !endpoint || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    enabled: true,
    strict: envTruthyLocal("FLUX_R2_BACKUPS_STRICT"),
    bucket,
    prefix,
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
  };
}

/** Safe env key listing for diagnostics — redacts sensitive names. */
export function listOffsiteEnvKeysForDiagnostics(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return Object.keys(env)
    .filter((k) => k.startsWith("FLUX_R2_"))
    .map((k) => (isSensitiveEnvName(k) ? `${k}=[REDACTED]` : k));
}
