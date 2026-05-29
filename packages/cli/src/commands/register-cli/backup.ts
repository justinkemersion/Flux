import { type Command } from "commander";
import {
  cmdBackupCreate,
  cmdBackupDownload,
  cmdBackupList,
  cmdBackupVerify,
} from "../../cli-handlers";
import { cliActionWithFlux, HASH_FLAG_DESC } from "./shared";

export function registerBackupCommands(program: Command): void {
  const backupCmd = program
    .command("backup")
    .description("Create, list, and download project backups (v1 full DB or v2 tenant export)");

  const backupCreateCmd = backupCmd
    .command("create")
    .description("Create a new backup and store it in Flux backup storage")
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option(
      "-p, --project <name>",
      "Project slug (overrides positional if set)",
    )
    .option("--hash <hex>", HASH_FLAG_DESC);

  backupCreateCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      const opts = backupCreateCmd.opts<{ project?: string; hash?: string }>();
      await cmdBackupCreate(name, opts.project, opts.hash, flux);
    }),
  );

  const backupListCmd = backupCmd
    .command("list")
    .description("List project backups")
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option(
      "-p, --project <name>",
      "Project slug (overrides positional if set)",
    )
    .option("--hash <hex>", HASH_FLAG_DESC)
    .option(
      "--verbose",
      "Include reconcile timestamps / artifact paths + full-width columns per backup",
      false,
    );

  backupListCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      const opts = backupListCmd.opts<{
        project?: string;
        hash?: string;
        verbose: boolean;
      }>();
      await cmdBackupList(
        name,
        opts.project,
        opts.hash,
        opts.verbose === true,
        flux,
      );
    }),
  );

  const backupDownloadCmd = backupCmd
    .command("download")
    .description("Download backup artifact (pg_dump -Fc); use -o or shell redirect — not a terminal")
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option(
      "-p, --project <name>",
      "Project slug (overrides positional if set)",
    )
    .option("--id <backupId>", "Backup ID to download")
    .option("--latest", "Download newest backup", false)
    .option(
      "-o, --output <path>",
      "Write to file (recommended). Refuses to write binary to a TTY without this.",
    )
    .option("--hash <hex>", HASH_FLAG_DESC);

  backupDownloadCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      const opts = backupDownloadCmd.opts<{
        project?: string;
        id?: string;
        latest?: boolean;
        output?: string;
        hash?: string;
      }>();
      await cmdBackupDownload(
        name,
        opts.project,
        opts.hash,
        opts.id,
        opts.latest === true,
        opts.output,
        flux,
      );
    }),
  );

  const backupVerifyCmd = backupCmd
    .command("verify")
    .description("Run real restore verification for a backup using pg_restore")
    .argument(
      "[name]",
      "Project slug (default: \"slug\" in flux.json)",
    )
    .option(
      "-p, --project <name>",
      "Project slug (overrides positional if set)",
    )
    .option("--id <backupId>", "Backup ID to verify")
    .option("--latest", "Verify newest backup", false)
    .option("--hash <hex>", HASH_FLAG_DESC);

  backupVerifyCmd.action(
    cliActionWithFlux(async (flux, name: string | undefined) => {
      const opts = backupVerifyCmd.opts<{
        project?: string;
        id?: string;
        latest?: boolean;
        hash?: string;
      }>();
      await cmdBackupVerify(
        name,
        opts.project,
        opts.hash,
        opts.id,
        opts.latest === true,
        flux,
      );
    }),
  );
}
