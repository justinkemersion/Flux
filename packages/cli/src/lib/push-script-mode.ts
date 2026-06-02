import {
  inferDefaultSingleFilePushMode,
  parsePushScriptMode,
  type PushScriptMode,
} from "@flux/core/sql-repeatable-scripts";

export type { PushScriptMode };

export function resolvePushScriptMode(input: {
  explicitMode?: string;
  resolvedFilePath: string;
  cwd?: string;
}): PushScriptMode {
  if (input.explicitMode?.trim()) {
    const parsed = parsePushScriptMode(input.explicitMode);
    if (!parsed) {
      throw new Error(
        'Invalid --mode. Use one of: raw, versioned, repeatable.',
      );
    }
    return parsed;
  }
  const inferred = inferDefaultSingleFilePushMode(
    input.resolvedFilePath,
    input.cwd ?? process.cwd(),
  );
  return inferred;
}

export function assertDirectoryPushScriptMode(mode: PushScriptMode): void {
  if (mode === "raw") {
    throw new Error(
      "--mode raw applies to single SQL files only. Directory pushes always use versioned migrations.",
    );
  }
  if (mode === "repeatable") {
    throw new Error(
      "--mode repeatable applies to single SQL files only. Use versioned migrations in a directory, or push one repeatable script at a time.",
    );
  }
}

export function assertForceRequiresRepeatable(
  force: boolean,
  mode: PushScriptMode,
): void {
  if (force && mode !== "repeatable") {
    throw new Error("--force requires --mode repeatable.");
  }
}
