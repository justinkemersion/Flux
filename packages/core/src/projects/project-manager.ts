import Docker from "dockerode";

import type { ImportSqlFileOptions } from "../import-dump.ts";
import type { ImportSqlFileResult, FluxProjectEnvEntry, FluxProjectSummary } from "../standalone.ts";
import type {
  FluxMigrationRecord,
  MigrationPushMeta,
} from "../sql-migrations.ts";
import {
  assertFluxDockerEngineReachableOrThrow,
  resolveProjectManagerDocker,
  type ProjectManagerConnectOptions,
} from "../docker/docker-client.ts";
import {
  postgresContainerName,
  postgrestContainerName,
} from "../docker/docker-names.ts";
import { createFluxCoreContext, type FluxCoreContext } from "../runtime/context.ts";
import { slugifyProjectName } from "../standalone.ts";

export type {
  FluxNodeStats,
  ProjectDumpOptions,
  FluxProjectCredentials,
  FluxSystemProjectActivity,
  FluxProject,
  ProvisionOptions,
  NukeProjectOptions,
  DeleteProjectInfrastructureResult,
  FluxProjectSlugRef,
} from "./project-manager/types.ts";

import {
  getPostgresHostConnectionString,
  getPostgresSuperuserPassword,
  getProjectCredentials,
  getProjectCustomBackupStream,
  getProjectDumpStream,
  getProjectKeys,
} from "./project-manager/credentials.ts";
import {
  deleteProjectInfrastructure,
  getContainerLogs,
  getNodeStats,
  getProjectSummariesForSlugs,
  getProjectSummariesForUser,
  getTenantContainerLogs,
  listProjects,
  lookupProjectHashBySlug,
  nukeContainersOnly,
  nukeProject,
  reapIdleProjects,
  startProject,
  startProjectInfrastructure,
  stopInactiveProjects,
  stopProject,
} from "./project-manager/fleet.ts";
import { removeTenantPrivateNetworkAllowMissing } from "./project-manager/network.ts";
import {
  getProjectAllowedOrigins,
  listProjectEnv,
  reconcilePostgrestTraefikLabels,
  setPostgrestSupabaseRestPrefix,
  setProjectAllowedOrigins,
  setProjectEnv,
  updatePostgrestJwtSecret,
} from "./project-manager/postgrest.ts";
import { provisionProject } from "./project-manager/provision.ts";
import {
  executeSql,
  importSqlFile,
  listAppliedSqlMigrations,
  pushSqlFromCli,
  queryTenantJsonRows,
  replaceTenantApiSchemaFromPlainSqlFile,
  resetTenantDatabaseForImport,
} from "./project-manager/sql.ts";
export { testDockerConnection } from "./project-manager/test-docker.ts";

import type {
  DeleteProjectInfrastructureResult,
  FluxNodeStats,
  FluxProject,
  FluxProjectCredentials,
  FluxProjectSlugRef,
  FluxSystemProjectActivity,
  NukeProjectOptions,
  ProjectDumpOptions,
  ProvisionOptions,
} from "./project-manager/types.ts";

/**
 * Orchestrates Docker resources for Flux projects: shared network, Postgres, PostgREST.
 *
 * Pass a {@link Docker} instance, {@link ProjectManagerConnectOptions} (remote `host` / `protocol`,
 * or injected `docker`), or omit the argument to use {@link createFluxDocker} (`DOCKER_HOST` + default
 * socket, same as the Docker CLI).
 *
 * When **`DOCKER_HOST`** is set or a remote **`host`** was passed, {@link provisionProject} (and
 * {@link assertDockerEngineReachableOrThrow}) **ping** that Engine first and **throw** if it is
 * unreachable—there is no fallback to `/var/run/docker.sock`.
 */
export class ProjectManager {
  private readonly ctx: FluxCoreContext;

  constructor(docker?: Docker);
  constructor(options?: ProjectManagerConnectOptions);
  constructor(arg?: Docker | ProjectManagerConnectOptions) {
    this.ctx = createFluxCoreContext(resolveProjectManagerDocker(arg));
  }

  async assertDockerEngineReachableOrThrow(): Promise<void> {
    await assertFluxDockerEngineReachableOrThrow(this.ctx.docker);
  }

  async getNodeStats(): Promise<FluxNodeStats> {
    return getNodeStats(this.ctx);
  }

  static containerNamesForSlug(
    slug: string,
    hash: string,
  ): {
    postgres: string;
    postgrest: string;
  } {
    const normalized = slugifyProjectName(slug);
    return {
      postgres: postgresContainerName(hash, normalized),
      postgrest: postgrestContainerName(hash, normalized),
    };
  }

  async provisionProject(
    name: string,
    options?: ProvisionOptions,
    hash?: string,
  ): Promise<FluxProject> {
    return provisionProject(this.ctx, name, options, hash);
  }

  async setProjectEnv(
    slug: string,
    envs: Record<string, string>,
    hash: string,
  ): Promise<void> {
    return setProjectEnv(this.ctx, slug, envs, hash);
  }

  async setPostgrestSupabaseRestPrefix(
    projectName: string,
    enabled: boolean,
    hash: string,
  ): Promise<void> {
    return setPostgrestSupabaseRestPrefix(this.ctx, projectName, enabled, hash);
  }

  async reconcilePostgrestTraefikLabels(
    projectName: string,
    hash: string,
    options?: Parameters<typeof reconcilePostgrestTraefikLabels>[3],
  ): Promise<void> {
    return reconcilePostgrestTraefikLabels(this.ctx, projectName, hash, options);
  }

  async getProjectAllowedOrigins(
    projectName: string,
    hash: string,
  ): Promise<readonly string[]> {
    return getProjectAllowedOrigins(this.ctx, projectName, hash);
  }

  async setProjectAllowedOrigins(
    projectName: string,
    origins: readonly string[],
    hash: string,
    options?: { onStatus?: (message: string) => void },
  ): Promise<void> {
    return setProjectAllowedOrigins(this.ctx, projectName, origins, hash, options);
  }

  async listProjectEnv(slug: string, hash: string): Promise<FluxProjectEnvEntry[]> {
    return listProjectEnv(this.ctx, slug, hash);
  }

  async updatePostgrestJwtSecret(
    projectName: string,
    newJwtSecret: string,
    hash: string,
  ): Promise<void> {
    return updatePostgrestJwtSecret(this.ctx, projectName, newJwtSecret, hash);
  }

  async getPostgresHostConnectionString(
    projectName: string,
    hash: string,
  ): Promise<string> {
    return getPostgresHostConnectionString(this.ctx, projectName, hash);
  }

  async getProjectKeys(
    slug: string,
    hash: string,
  ): Promise<{ anonKey: string; serviceRoleKey: string }> {
    return getProjectKeys(this.ctx, slug, hash);
  }

  async getProjectCredentials(
    projectName: string,
    hash: string,
  ): Promise<FluxProjectCredentials> {
    return getProjectCredentials(this.ctx, projectName, hash);
  }

  async getProjectDumpStream(
    slug: string,
    hash: string,
    options?: ProjectDumpOptions,
  ): Promise<import("node:stream").Readable> {
    return getProjectDumpStream(this.ctx, slug, hash, options);
  }

  async getProjectCustomBackupStream(
    slug: string,
    hash: string,
  ): Promise<import("node:stream").Readable> {
    return getProjectCustomBackupStream(this.ctx, slug, hash);
  }

  async executeSql(
    projectName: string,
    sql: string,
    hash: string,
  ): Promise<void> {
    return executeSql(this.ctx, projectName, sql, hash);
  }

  async listAppliedSqlMigrations(
    projectName: string,
    hash: string,
    tenantSchema: string,
  ): Promise<FluxMigrationRecord[]> {
    return listAppliedSqlMigrations(this.ctx, projectName, hash, tenantSchema);
  }

  async pushSqlFromCli(
    projectName: string,
    hash: string,
    sql: string,
    options?: {
      searchPathSchemas?: readonly string[];
      migration?: MigrationPushMeta;
    },
  ): Promise<{ skipped: boolean }> {
    return pushSqlFromCli(this.ctx, projectName, hash, sql, options);
  }

  async importSqlFile(
    slug: string,
    filePath: string,
    hash: string,
    options?: ImportSqlFileOptions,
  ): Promise<ImportSqlFileResult> {
    return importSqlFile(this.ctx, slug, filePath, hash, options);
  }

  async replaceTenantApiSchemaFromPlainSqlFile(
    projectName: string,
    hash: string,
    hostFilePath: string,
    apiSchemaName: string,
  ): Promise<void> {
    return replaceTenantApiSchemaFromPlainSqlFile(
      this.ctx,
      projectName,
      hash,
      hostFilePath,
      apiSchemaName,
    );
  }

  async queryTenantJsonRows(
    projectName: string,
    hash: string,
    selectSql: string,
  ): Promise<unknown[]> {
    return queryTenantJsonRows(this.ctx, projectName, hash, selectSql);
  }

  async resetTenantDatabaseForImport(
    projectName: string,
    hash: string,
    options?: { apiSchemaName?: string },
  ): Promise<void> {
    return resetTenantDatabaseForImport(this.ctx, projectName, hash, options);
  }

  async getPostgresSuperuserPassword(
    projectName: string,
    hash: string,
  ): Promise<string> {
    return getPostgresSuperuserPassword(this.ctx, projectName, hash);
  }

  async listProjects(): Promise<FluxProjectSummary[]> {
    return listProjects(this.ctx);
  }

  async getProjectSummariesForSlugs(
    refs: FluxProjectSlugRef[],
    options?: { isProduction?: boolean },
  ): Promise<FluxProjectSummary[]> {
    return getProjectSummariesForSlugs(this.ctx, refs, options);
  }

  async getProjectSummariesForUser(
    userId: string,
    options: {
      loadSlugRefsForUser: (
        userId: string,
      ) => Promise<readonly FluxProjectSlugRef[]>;
      isProduction?: boolean;
    },
  ): Promise<FluxProjectSummary[]> {
    return getProjectSummariesForUser(this.ctx, userId, options);
  }

  async lookupProjectHashBySlug(
    slug: string,
    ownerKey?: string,
  ): Promise<string | null> {
    return lookupProjectHashBySlug(this.ctx, slug, ownerKey);
  }

  async stopInactiveProjects(
    maxAgeDays: number,
  ): Promise<FluxSystemProjectActivity[]> {
    return stopInactiveProjects(this.ctx, maxAgeDays);
  }

  async reapIdleProjects(maxIdleHours: number): Promise<{
    stopped: string[];
    errors: Array<{ slug: string; message: string }>;
  }> {
    return reapIdleProjects(this.ctx, maxIdleHours);
  }

  async stopProject(name: string, hash: string): Promise<void> {
    return stopProject(this.ctx, name, hash);
  }

  async startProjectInfrastructure(slug: string, hash: string): Promise<void> {
    return startProjectInfrastructure(this.ctx, slug, hash);
  }

  async startProject(name: string, hash: string): Promise<void> {
    return startProject(this.ctx, name, hash);
  }

  async nukeProject(
    name: string,
    options: NukeProjectOptions,
  ): Promise<void> {
    return nukeProject(this.ctx, name, options);
  }

  async deleteProjectInfrastructure(
    slug: string,
    hash: string,
  ): Promise<DeleteProjectInfrastructureResult> {
    return deleteProjectInfrastructure(this.ctx, slug, hash);
  }

  async nukeContainersOnly(slug: string, hash: string): Promise<void> {
    return nukeContainersOnly(this.ctx, slug, hash);
  }

  async getTenantContainerLogs(
    slug: string,
    hash: string,
    kind: "api" | "db",
    options?: { tail?: number },
  ): Promise<string> {
    return getTenantContainerLogs(this.ctx, slug, hash, kind, options);
  }

  async getContainerLogs(
    slug: string,
    hash: string,
    service: "api" | "db",
    options?: { tail?: number; signal?: AbortSignal },
  ): Promise<ReadableStream<Uint8Array>> {
    return getContainerLogs(this.ctx, slug, hash, service, options);
  }

  async removeTenantPrivateNetworkAllowMissing(
    slug: string,
    hash: string,
  ): Promise<void> {
    return removeTenantPrivateNetworkAllowMissing(this.ctx, slug, hash);
  }
}
