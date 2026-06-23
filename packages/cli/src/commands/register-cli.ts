import { type Command } from "commander";
import { registerAuthCommands } from "./register-cli/auth";
import { registerBackupCommands } from "./register-cli/backup";
import { registerDbCommands } from "./register-cli/db";
import { registerEnvCommands } from "./register-cli/env";
import { registerInitCreateCommands } from "./register-cli/init-create";
import { registerInspectCommands } from "./register-cli/inspect";
import { registerLifecycleCommands } from "./register-cli/lifecycle";
import { registerMigrationsSqlCommands } from "./register-cli/migrations-sql";
import { registerPostgrestConfigCommands } from "./register-cli/postgrest-config";
import { registerGauntletCommands } from "./register-cli/gauntlet";
import { registerDoctorCommands } from "./register-cli/doctor";
import { registerActivityCommands } from "./register-cli/activity";
import { registerProjectMetadataCommands } from "./register-cli/project-metadata";
import { registerProjectBriefCommands } from "./register-cli/project-brief";
import { registerProjectSummarizeCommands } from "./register-cli/project-summarize";
import { registerProjectLifecycleCommands } from "./register-cli/project-lifecycle-state";

export function registerFluxCliCommands(program: Command): void {
  program
    .name("flux")
    .description(
      "Flux — control plane for tenant Postgres/PostgREST. Version: `flux -V` | `flux version`",
    );

  registerAuthCommands(program);
  registerInitCreateCommands(program);
  registerMigrationsSqlCommands(program);
  registerPostgrestConfigCommands(program);
  registerGauntletCommands(program);
  registerInspectCommands(program);
  registerBackupCommands(program);
  registerDbCommands(program);
  registerLifecycleCommands(program);
  registerEnvCommands(program);
  registerDoctorCommands(program);
  registerActivityCommands(program);
  registerProjectMetadataCommands(program);
  registerProjectBriefCommands(program);
  registerProjectSummarizeCommands(program);
  registerProjectLifecycleCommands(program);
}
