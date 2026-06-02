import { type Command } from "commander";
import { getApiClient } from "../../api-client";
import {
  cmdDbReset,
  ensureRestoreVerifiedLatestBackup,
} from "../../cli-handlers";
import { resolveHash, resolveProjectSlug } from "../../project-resolve";
import { cmdMigrationsList } from "../migrations";
import { cmdPush } from "../push";
import { cliActionWithFlux, HASH_FLAG_DESC } from "./shared";

export function registerMigrationsSqlCommands(program: Command): void {
  const push = program
    .command("push")
    .description(
      "Apply SQL to a project. Directory: versioned migrations (flux.flux_migrations). Single file: raw (default outside migrations/), versioned (under migrations/), or repeatable (--mode).",
    )
    .argument(
      "[target]",
      "migrations directory (ledger + checksums) or .sql file (no ledger); default discovery: migrations/, flux/migrations/, sql/, schema.sql",
    )
    .option(
      "-p, --project <name>",
      "Project slug (default: \"slug\" in flux.json in CWD)",
    )
    .option(
      "-s, --supabase-compat",
      "Supabase mode: post-import migration and report (when API supports it)",
      false,
    )
    .option(
      "--no-sanitize",
      "Do not strip SET session lines for target Postgres (when API supports it)",
    )
    .option(
      "--disable-api-rls",
      "Disable RLS on api tables after import (when API supports it)",
      false,
    )
    .option("--hash <hex>", HASH_FLAG_DESC)
    .option(
      "--plan",
      "Directory only: show skip / would apply / conflicts without applying (single file: preview only)",
      false,
    )
    .option(
      "--dry-run",
      "Directory: validate plan, conflicts, and 4 MiB per pending file; file: size check + preview. Incompatible with --plan",
      false,
    )
    .option(
      "--mode <mode>",
      "Single file: raw | versioned | repeatable (default inferred from path)",
    )
    .option(
      "--force",
      "With --mode repeatable: run even when checksum is unchanged",
      false,
    )
    .option(
      "--id <scriptId>",
      "With --mode repeatable: stable script identity (default: repo-relative path)",
    );

  push.addHelpText(
    "after",
    `
Examples:
  $ flux push migrations/ --plan
  $ flux push migrations/ --dry-run
  $ flux push flux/scripts/seed.sql --mode repeatable --force
  $ flux migrations list
`,
  );

  push.action(
    cliActionWithFlux(async (flux, target: string | undefined) => {
      const opts = push.opts<{
        project?: string;
        supabaseCompat: boolean;
        noSanitize?: boolean;
        disableApiRls?: boolean;
        hash?: string;
        plan?: boolean;
        dryRun?: boolean;
        mode?: string;
        force?: boolean;
        id?: string;
      }>();
      if (opts.plan && opts.dryRun) {
        throw new Error("Use only one of --plan or --dry-run.");
      }
      const pushMode = opts.dryRun
        ? ("dry-run" as const)
        : opts.plan
          ? ("plan" as const)
          : ("apply" as const);
      await cmdPush(
        target,
        opts.project ?? "",
        {
          supabaseCompat: opts.supabaseCompat,
          noSanitize: opts.noSanitize === true,
          disableApiRls: opts.disableApiRls === true,
          pushMode,
          ...(opts.hash ? { hash: opts.hash } : {}),
          ...(opts.mode ? { explicitScriptMode: opts.mode } : {}),
          ...(opts.force ? { force: true } : {}),
          ...(opts.id ? { scriptId: opts.id } : {}),
        },
        flux,
      );
    }),
  );

  const migrationsCmd = program
    .command("migrations")
    .description(
      "Remote SQL migration ledger (flux.flux_migrations). Not flux migrate (v2_shared → v1_dedicated engine conversion).",
    );

  const migrationsListCmd = migrationsCmd
    .command("list")
    .description(
      "List applied migrations on the project (remote ledger, not local files). Compare local vs remote with flux push <dir> --plan",
    )
    .option(
      "-p, --project <name>",
      "Project slug (default: \"slug\" in flux.json in CWD)",
    )
    .option("--hash <hex>", HASH_FLAG_DESC);

  migrationsListCmd.action(
    cliActionWithFlux(async (flux) => {
      const opts = migrationsListCmd.opts<{
        project?: string;
        hash?: string;
      }>();
      await cmdMigrationsList(opts.project ?? "", opts, flux);
    }),
  );

  const migrateCmd = program
    .command("migrate")
    .description(
      "Migrate a v2_shared (pooled) project to v1_dedicated via the control plane (downtime expected)",
    )
    .option(
      "-p, --project <slug>",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option("--to <mode>", "Target mode", "v1_dedicated")
    .option("--dry-run", "Show plan and preflight only", false)
    .option("-y, --yes", "Confirm destructive migration", false)
    .option(
      "--staged",
      "Provision dedicated DB and restore, but do not flip catalog mode yet",
      false,
    )
    .option(
      "--dump-only",
      "Only run pg_dump from the shared cluster to a temp file (no Docker changes)",
      false,
    )
    .option("--new-jwt-secret", "Rotate jwt_secret on switch", false)
    .option(
      "--no-lock-writes",
      "Do not enter gateway maintenance (migration_status)",
      false,
    )
    .option(
      "--drop-source-after",
      "After success, drop the tenant from the shared cluster (destructive)",
      false,
    )
    .option(
      "--skip-backup-check",
      "Skip requiring a restore-verified backup before migrate (dangerous)",
      false,
    )
    .option("--hash <hex>", HASH_FLAG_DESC);

  migrateCmd.action(
    cliActionWithFlux(async (flux) => {
      const opts = migrateCmd.opts<{
        project?: string;
        to: string;
        dryRun: boolean;
        yes: boolean;
        staged: boolean;
        dumpOnly: boolean;
        newJwtSecret: boolean;
        noLockWrites: boolean;
        dropSourceAfter: boolean;
        skipBackupCheck: boolean;
        hash?: string;
      }>();
      if (opts.to !== "v1_dedicated") {
        throw new Error("Only --to v1_dedicated is supported today.");
      }
      const slug = resolveProjectSlug(
        opts.project ?? "",
        flux,
        "-p, --project",
      );
      const client = getApiClient();
      const hash = resolveHash(opts.hash, flux);
      const meta = await client.getProjectMetadata(hash);
      if (meta.slug !== slug) {
        throw new Error(
          `flux.json hash resolves to slug "${meta.slug}" but --project is "${slug}".`,
        );
      }
      if (meta.mode !== "v2_shared") {
        throw new Error(
          `flux migrate requires v2_shared; this project is ${meta.mode}.`,
        );
      }
      if (!opts.dryRun && !opts.skipBackupCheck) {
        await ensureRestoreVerifiedLatestBackup(client, hash, false);
      }
      if (opts.staged && opts.newJwtSecret) {
        throw new Error(
          "--new-jwt-secret cannot be used with --staged (catalog jwt_secret would not match the new stack). Run a full migrate without --staged to rotate secrets.",
        );
      }
      const result = await client.migrateV2ToV1({
        slug,
        hash,
        dryRun: opts.dryRun,
        yes: opts.yes,
        staged: opts.staged,
        dumpOnly: opts.dumpOnly,
        newJwtSecret: opts.newJwtSecret,
        noLockWrites: opts.noLockWrites,
        dropSourceAfter: opts.dropSourceAfter,
        preserveJwtSecret: !opts.newJwtSecret,
        lockWrites: !opts.noLockWrites,
        skipBackupCheck: opts.skipBackupCheck === true,
      });
      console.log(JSON.stringify(result, null, 2));
    }),
  );

  const dbReset = program
    .command("db-reset")
    .description(
      "Reset tenant DB: drop public and auth, reapply Flux bootstrap (irreversible data loss in those schemas)",
    )
    .option(
      "-p, --project <name>",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option("-y, --yes", "confirm", false)
    .option(
      "--skip-backup-check",
      "Allow reset even when the latest backup is not restore-verified (dangerous)",
      false,
    )
    .option("--hash <hex>", HASH_FLAG_DESC);

  dbReset.action(
    cliActionWithFlux(async (flux) => {
      const opts = dbReset.opts<{
        project?: string;
        yes: boolean;
        skipBackupCheck: boolean;
        hash?: string;
      }>();
      await cmdDbReset(
        opts.project ?? "",
        opts.yes,
        opts.skipBackupCheck === true,
        opts.hash,
        flux,
      );
    }),
  );
}
