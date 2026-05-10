import { z } from "zod";

export const fluxProjectSummarySchema = z.object({
  slug: z.string(),
  hash: z.string(),
  status: z.enum([
    "running",
    "stopped",
    "partial",
    "missing",
    "corrupted",
  ]),
  apiUrl: z.string(),
});

export const listProjectsResponseSchema = z.array(fluxProjectSummarySchema);

export const createProjectSecretsSchema = z.object({
  pgrstJwtSecret: z.string(),
  postgresPassword: z.string(),
  postgresContainerHost: z.string(),
  note: z.string(),
});

export const createProjectResponseSchema = z.object({
  summary: fluxProjectSummarySchema,
  /** Provisioning mode chosen for this project (same as catalog `projects.mode`). */
  mode: z.enum(["v1_dedicated", "v2_shared"]),
  /** Present on control planes that expose the canonical tenant JWT (same as secrets.pgrstJwtSecret when set). */
  projectJwtSecret: z.string().optional(),
  secrets: createProjectSecretsSchema,
});

export const projectCredentialsV2Schema = z.object({
  mode: z.literal("v2_shared"),
  slug: z.string(),
  hash: z.string(),
  projectJwtSecret: z.string(),
  note: z.string(),
});

export const projectCredentialsV1Schema = z.object({
  mode: z.literal("v1_dedicated"),
  slug: z.string(),
  hash: z.string(),
  projectJwtSecret: z.string().optional(),
  postgresConnectionString: z.string(),
  anonKey: z.string(),
  serviceRoleKey: z.string(),
});

export const projectCredentialsResponseSchema = z.discriminatedUnion("mode", [
  projectCredentialsV2Schema,
  projectCredentialsV1Schema,
]);

export const verifyTokenResponseSchema = z.object({
  ok: z.literal(true),
  user: z.string(),
  plan: z.union([z.literal("hobby"), z.literal("pro")]),
  defaultMode: z.union([z.literal("v1_dedicated"), z.literal("v2_shared")]),
});

export const projectMetadataSchema = z.object({
  slug: z.string(),
  hash: z.string(),
  mode: z.union([z.literal("v1_dedicated"), z.literal("v2_shared")]),
  /** Resolved PostgREST primary schema (`api` or `t_<shortId>_api`). */
  apiSchema: z.string().optional(),
});

export const pushSqlResponseSchema = z.object({
  ok: z.boolean().optional(),
  tablesMoved: z.number(),
  sequencesMoved: z.number(),
  viewsMoved: z.number(),
});

export const backupItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["project_db", "tenant_export"]).optional(),
  /** Relative path under FLUX_BACKUPS_LOCAL_DIR on the control plane. */
  primaryArtifactRelativePath: z.string().optional(),
  /** Resolved path on the API server (inside flux-web / Docker). */
  primaryArtifactAbsolutePath: z.string().optional(),
  format: z.string(),
  status: z.string(),
  sizeBytes: z.number().nullable().optional(),
  checksumSha256: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  offsiteStatus: z.string().nullable().optional(),
  offsiteCompletedAt: z.string().nullable().optional(),
  artifactValidationStatus: z.string().nullable().optional(),
  artifactValidationAt: z.string().nullable().optional(),
  artifactValidationError: z.string().nullable().optional(),
  restoreVerificationStatus: z.string().nullable().optional(),
  restoreVerificationAt: z.string().nullable().optional(),
  restoreVerificationError: z.string().nullable().optional(),
});

export const listBackupsResponseSchema = z.object({
  backups: z.array(backupItemSchema),
  backupVolumeAbsoluteRoot: z.string().optional(),
  reconciledAt: z.string().optional(),
});

export const createBackupResponseSchema = z.object({
  backup: backupItemSchema,
});

export const verifyBackupResponseSchema = z.object({
  ok: z.literal(true),
  backupId: z.string(),
  restoreVerificationStatus: z.string(),
});

export const nukeProjectSuccessSchema = z.object({
  ok: z.literal(true),
  mode: z.union([z.literal("catalog"), z.literal("orphan")]),
});

export const projectEnvListResponseSchema = z.array(
  z.union([
    z.object({
      key: z.string(),
      sensitive: z.literal(true),
    }),
    z.object({
      key: z.string(),
      value: z.string(),
      sensitive: z.literal(false),
    }),
  ]),
);

export type CreateProjectSecrets = z.infer<typeof createProjectSecretsSchema>;
export type CreateProjectResult = z.infer<typeof createProjectResponseSchema>;
export type ProjectCredentialsByHash = z.infer<
  typeof projectCredentialsResponseSchema
>;
export type CreateProjectMode = "v1_dedicated" | "v2_shared";
export type VerifyTokenResult = z.infer<typeof verifyTokenResponseSchema>;
export type ProjectMetadata = z.infer<typeof projectMetadataSchema>;
export type ProjectBackup = z.infer<typeof backupItemSchema>;
export type ListProjectBackupsResult = {
  backups: ProjectBackup[];
  backupVolumeAbsoluteRoot?: string;
  reconciledAt?: string;
};
export type VerifyBackupResult = z.infer<typeof verifyBackupResponseSchema>;
