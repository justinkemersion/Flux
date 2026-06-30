/**
 * flux.backup.ensureVerified — create and restore-verify a backup when needed.
 *
 * Protective mutation only: establishes backup trust for future destructive gates.
 * Does not accept skipBackupCheck.
 */

import {
  classifyNewestBackup,
  backupTrustBlockedGuidance,
} from "@flux/core/backup-trust";
import type { BackupTrustInput, BackupTrustTier } from "@flux/core/backup-trust";
import type { ProjectBackup } from "@flux/cli/api-client";
import type { FluxToolClient } from "./index";
import { InvalidInputError, fail, ok, type ToolResult } from "../result";
import { platformBackupCompliantFromList } from "./backup-sanitize";

export interface BackupEnsureContext {
  intentId: string;
}

export interface BackupEnsureData {
  backupId: string;
  created: boolean;
  verified: boolean;
  trustTier: BackupTrustTier;
  detail: string;
  platformBackupCompliant?: boolean;
  intentId: string;
}

const POLL_INTERVAL_MS = 2_000;
const MAX_WAIT_MS = 180_000;

function requireHash(args: Record<string, unknown>): string {
  const hash = args.hash;
  if (typeof hash !== "string" || !/^[a-f0-9]{7}$/u.test(hash.trim().toLowerCase())) {
    throw new InvalidInputError("hash must be a 7-char hex project id.");
  }
  return hash.trim().toLowerCase();
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") {
    throw new InvalidInputError(`${key} must be a boolean when provided.`);
  }
  return v;
}

function optionalPositiveNumber(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
    throw new InvalidInputError(`${key} must be a positive number when provided.`);
  }
  return v;
}

function backupAgeHours(createdAt: string | null | undefined): number | null {
  if (!createdAt) return null;
  const ts = Date.parse(createdAt);
  if (!Number.isFinite(ts)) return null;
  return (Date.now() - ts) / (1000 * 60 * 60);
}

function satisfiesMaxAge(
  backup: Pick<ProjectBackup, "createdAt">,
  maxAgeHours: number | undefined,
): boolean {
  if (maxAgeHours === undefined) return true;
  const age = backupAgeHours(backup.createdAt);
  if (age === null) return false;
  return age <= maxAgeHours;
}

function isBackupVerifiable(row: ProjectBackup): boolean {
  if (row.status !== "complete") return false;
  const art = (row.artifactValidationStatus ?? "pending").trim();
  return art !== "pending";
}

export function backupEnsureAuditGate(result: ToolResult): string {
  if (!result.ok) return "backup_ensure_failed";
  const data = result.data as BackupEnsureData | null;
  if (data && data.created === false && data.verified === true) {
    return "backup_ensure_reused";
  }
  if (data && data.verified === true) return "backup_ensure_verified";
  return "backup_ensure_failed";
}

export function isBackupEnsureOperationSuccessful(result: ToolResult): boolean {
  const data = result.data as BackupEnsureData | null;
  if (!data || typeof data !== "object") return false;
  return data.verified === true && data.trustTier === "restorable";
}

async function waitForBackupReady(
  client: FluxToolClient,
  hash: string,
  backupId: string,
  wait: boolean,
  sleepMs: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<ProjectBackup | undefined> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (true) {
    const listed = await client.listProjectBackups(hash);
    const row =
      listed.backups.find((b) => b.id === backupId) ?? listed.backups[0];
    if (!row) return undefined;
    if (isBackupVerifiable(row)) return row;
    if (!wait || Date.now() >= deadline) return row;
    await sleepMs(POLL_INTERVAL_MS);
  }
}

function buildSuccessData(
  input: {
    backupId: string;
    created: boolean;
    verified: boolean;
    trustTier: BackupTrustTier;
    detail: string;
    platformBackupCompliant?: boolean | undefined;
  },
  intentId: string,
): BackupEnsureData {
  return {
    backupId: input.backupId,
    created: input.created,
    verified: input.verified,
    trustTier: input.trustTier,
    detail: input.detail,
    intentId,
    ...(input.platformBackupCompliant !== undefined
      ? { platformBackupCompliant: input.platformBackupCompliant }
      : {}),
  };
}

export async function runBackupEnsureVerified(
  client: FluxToolClient,
  args: Record<string, unknown>,
  ctx: BackupEnsureContext,
  deps: {
    sleepMs?: (ms: number) => Promise<void>;
  } = {},
): Promise<ToolResult> {
  const hash = requireHash(args);
  const verifyLatestIfFresh = optionalBoolean(args, "verifyLatestIfFresh") ?? true;
  const maxAgeHours = optionalPositiveNumber(args, "maxAgeHours");
  const wait = optionalBoolean(args, "wait") ?? true;
  const sleepMs = deps.sleepMs ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const initial = await client.listProjectBackups(hash);
  const initialBackups = initial.backups as unknown as BackupTrustInput[];
  const initialClassification = classifyNewestBackup(initialBackups);
  const platformCompliant = platformBackupCompliantFromList(initial);

  if (
    verifyLatestIfFresh &&
    initialClassification.allowsDestructiveWithoutOverride &&
    initial.backups[0] &&
    satisfiesMaxAge(initial.backups[0], maxAgeHours)
  ) {
    const latest = initial.backups[0]!;
    return ok(
      "Latest backup is already restore-verified; no new backup created.",
      buildSuccessData(
        {
          backupId: latest.id,
          created: false,
          verified: true,
          trustTier: initialClassification.tier,
          detail: initialClassification.detail,
          ...(platformCompliant !== undefined
            ? { platformBackupCompliant: platformCompliant }
            : {}),
        },
        ctx.intentId,
      ),
    );
  }

  let backupId: string;
  const createdResult = await client.createProjectBackup(hash);
  backupId = createdResult.backup.id;
  const created = true;
  const platformCompliantAfterCreate = platformBackupCompliantFromList(createdResult);

  const ready = await waitForBackupReady(client, hash, backupId, wait, sleepMs);
  if (!ready || ready.status !== "complete") {
    return fail("Backup is not complete; cannot verify restore yet.", {
      data: buildSuccessData(
        {
          backupId,
          created,
          verified: false,
          trustTier: "latest_not_complete",
          detail: ready
            ? `Latest backup status is "${ready.status}", not complete.`
            : "Backup row missing after create.",
        },
        ctx.intentId,
      ),
      remediation:
        "Wait for the backup to finish, then run flux.backup.ensureVerified again.",
    }) as ToolResult;
  }

  try {
    await client.verifyProjectBackup({ hash, backupId });
  } catch {
    const afterList = await client.listProjectBackups(hash);
    const classification = classifyNewestBackup(
      afterList.backups as unknown as BackupTrustInput[],
    );
    return fail("Backup restore verification failed.", {
      data: buildSuccessData(
        {
          backupId,
          created,
          verified: false,
          trustTier: classification.tier,
          detail: classification.detail,
          ...(platformBackupCompliantFromList(afterList) !== undefined
            ? { platformBackupCompliant: platformBackupCompliantFromList(afterList) }
            : {}),
        },
        ctx.intentId,
      ),
      remediation: `${backupTrustBlockedGuidance(classification)} Re-run flux.backup.ensureVerified after resolving the backup issue.`,
    });
  }

  const finalList = await client.listProjectBackups(hash);
  const finalClassification = classifyNewestBackup(
    finalList.backups as unknown as BackupTrustInput[],
  );
  const finalCompliant = platformBackupCompliantFromList(finalList);

  if (!finalClassification.allowsDestructiveWithoutOverride) {
    return fail("Backup verification did not produce a restore-verified backup.", {
      data: buildSuccessData(
        {
          backupId,
          created,
          verified: false,
          trustTier: finalClassification.tier,
          detail: finalClassification.detail,
          ...(finalCompliant !== undefined ? { platformBackupCompliant: finalCompliant } : {}),
        },
        ctx.intentId,
      ),
      remediation: `${backupTrustBlockedGuidance(finalClassification)} Re-run flux.backup.ensureVerified.`,
    });
  }

  return ok(
    "Backup created and restore-verified.",
    buildSuccessData(
      {
        backupId,
        created,
        verified: true,
        trustTier: finalClassification.tier,
        detail: finalClassification.detail,
        ...(finalCompliant !== undefined
          ? { platformBackupCompliant: finalCompliant }
          : platformCompliantAfterCreate !== undefined
            ? { platformBackupCompliant: platformCompliantAfterCreate }
            : {}),
      },
      ctx.intentId,
    ),
  );
}
