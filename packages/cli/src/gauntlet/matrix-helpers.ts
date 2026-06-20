import { getApiClient } from "../api-client";
import { assertPostgrestHealthy } from "./health-probe";
import { isGauntletSlug, generateGauntletProjectName } from "./names";
import { pushGauntletSchema } from "./push-schema";
import { safeDeleteGauntletProject } from "./cleanup";
import {
  assertGauntletFixtureTablesPresent,
  inspectProjectSchema,
} from "./schema-inspector";
import type { SchemaInspectionResult } from "./schema-inspector-types";
import type { GauntletProjectCtx, GauntletRunOptions } from "./types";
import type { MatrixRunOptions } from "./matrix-types";

/** Map matrix options to gauntlet cleanup options (Ring 1 shape). */
export function matrixToGauntletOptions(
  options: MatrixRunOptions,
): GauntletRunOptions {
  return {
    mode: "v1_dedicated",
    runs: 1,
    keepFailed: options.keepFailed,
    reportDir: options.reportDir,
    prefix: options.prefix,
    skipBackup: false,
    json: options.json,
  };
}

export async function provisionV1GauntletProject(input: {
  options: MatrixRunOptions;
  reportDir: string;
  name?: string;
  createdProjectSlugs: Set<string>;
}): Promise<GauntletProjectCtx> {
  const client = getApiClient();
  const requestedName =
    input.name?.trim() || generateGauntletProjectName(input.options.prefix);

  const result = await client.createProject({
    name: requestedName,
    stripSupabaseRestPrefix: true,
    mode: "v1_dedicated",
  });

  const slug = result.summary.slug;
  if (!isGauntletSlug(slug, input.options.prefix)) {
    throw new Error(
      `Created slug "${slug}" does not match gauntlet marker — refusing to continue`,
    );
  }

  input.createdProjectSlugs.add(slug.toLowerCase());

  const metadata = await client.getProjectMetadata(result.summary.hash);
  const creds = await client.getProjectCredentialsByHash(result.summary.hash);
  if (creds.mode !== "v1_dedicated") {
    throw new Error("Expected v1_dedicated credentials");
  }

  const project: GauntletProjectCtx = {
    slug,
    hash: result.summary.hash,
    mode: "v1_dedicated",
    apiUrl: result.summary.apiUrl,
    apiSchema: metadata.apiSchema ?? "api",
    reportDir: input.reportDir,
    anonJwt: creds.anonKey,
    serviceRoleJwt: creds.serviceRoleKey,
    ...(creds.projectJwtSecret
      ? { projectJwt: creds.projectJwtSecret }
      : result.projectJwtSecret
        ? { projectJwt: result.projectJwtSecret }
        : {}),
    projectSummaryBefore: {
      summary: result.summary,
      mode: result.mode,
      apiSchema: metadata.apiSchema ?? "api",
    },
  };

  return project;
}

export async function pushValidGauntletSchema(
  project: GauntletProjectCtx,
): Promise<void> {
  await pushGauntletSchema(project);
}

export async function pushSqlString(
  project: GauntletProjectCtx,
  sql: string,
): Promise<void> {
  const client = getApiClient();
  await client.pushSql({
    slug: project.slug,
    hash: project.hash,
    sql,
  });
}

export const INVALID_SQL_FIXTURE = `
CREATE TABLE api.gauntlet_invalid_fk (
  id bigint PRIMARY KEY,
  broken_ref bigint REFERENCES api.no_such_table(id)
);
`.trim();

export async function assertApiHealthy(project: GauntletProjectCtx): Promise<void> {
  await assertPostgrestHealthy({
    apiUrl: project.apiUrl,
    apiSchema: project.apiSchema,
    mode: project.mode,
    hash: project.hash,
    ...(project.serviceRoleJwt !== undefined
      ? { serviceRoleJwt: project.serviceRoleJwt }
      : {}),
    maxAttempts: 15,
  });
}

export async function getProjectStatus(
  hash: string,
): Promise<string | undefined> {
  const client = getApiClient();
  const list = await client.listProjects();
  const row = list.find((p) => p.hash.toLowerCase() === hash.toLowerCase());
  return row?.status;
}

export async function assertProjectAbsent(slug: string): Promise<void> {
  const client = getApiClient();
  const list = await client.listProjects();
  const found = list.some(
    (p) => p.slug.toLowerCase() === slug.trim().toLowerCase(),
  );
  if (found) {
    throw new Error(`Project ${slug} still listed in catalog`);
  }
}

export async function verifyGauntletSchemaIntact(
  project: GauntletProjectCtx,
): Promise<SchemaInspectionResult> {
  const inspection = await inspectProjectSchema({
    slug: project.slug,
    hash: project.hash,
    mode: project.mode,
    apiSchema: project.apiSchema,
    apiUrl: project.apiUrl,
    includeExactCounts: true,
  });
  assertGauntletFixtureTablesPresent(inspection);
  return inspection;
}

export async function matrixCleanupProject(input: {
  project: GauntletProjectCtx;
  options: MatrixRunOptions;
  createdProjectSlugs: Set<string>;
  scenarioFailed: boolean;
}): Promise<{ cleanedUp: boolean; cleanupError?: string }> {
  if (input.options.keepFailed && input.scenarioFailed) {
    return { cleanedUp: false };
  }
  try {
    const result = await safeDeleteGauntletProject({
      project: input.project,
      options: matrixToGauntletOptions(input.options),
      createdProjectSlugs: input.createdProjectSlugs,
    });
    if (result.skipped) {
      return {
        cleanedUp: false,
        ...(result.reason ? { cleanupError: result.reason } : {}),
      };
    }
    return { cleanedUp: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      cleanedUp: false,
      cleanupError: `Cleanup failed for ${input.project.slug}: ${msg}`,
    };
  }
}

export async function attemptOperatorNuke(
  project: GauntletProjectCtx,
): Promise<{ blocked: boolean; message: string }> {
  const client = getApiClient();
  try {
    await client.nukeProject(project.slug, project.hash);
    return { blocked: false, message: "nuke succeeded (unexpected)" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const blocked =
      /412/u.test(msg) ||
      /restore-verified|restore verified|backup verify|not restore|destructive backup/i.test(
        msg,
      );
    return { blocked, message: msg };
  }
}

export async function expectOperationNotFound(
  label: string,
  fn: () => Promise<unknown>,
): Promise<string> {
  try {
    await fn();
    throw new Error(`${label}: expected not-found failure but operation succeeded`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/expected not-found failure/u.test(msg)) throw err;
    const ok =
      /404/u.test(msg) ||
      /not found/u.test(msg) ||
      /no project/u.test(msg) ||
      /does not match expected profile/u.test(msg) ||
      /Request failed \(404\)/u.test(msg);
    if (!ok) {
      throw new Error(
        `${label}: expected not-found style error, got: ${msg.slice(0, 300)}`,
      );
    }
    return msg.slice(0, 200);
  }
}

export function fakeMissingProject(): { slug: string; hash: string } {
  return {
    slug: generateGauntletProjectName("gauntlet"),
    hash: "0000000",
  };
}

export async function writeInvalidSqlArtifact(reportDir: string): Promise<string> {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(reportDir, { recursive: true });
  const invalidPath = join(reportDir, "invalid.sql");
  await writeFile(invalidPath, `${INVALID_SQL_FIXTURE}\n`, "utf8");
  return invalidPath;
}
