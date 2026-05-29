import { type Command } from "commander";
import { registerAuthCommands } from "./register-cli/auth";
import { registerBackupCommands } from "./register-cli/backup";
import { registerEnvCommands } from "./register-cli/env";
import { registerInitCreateCommands } from "./register-cli/init-create";
import { registerInspectCommands } from "./register-cli/inspect";
import { registerLifecycleCommands } from "./register-cli/lifecycle";
import { registerMigrationsSqlCommands } from "./register-cli/migrations-sql";
import { registerPostgrestConfigCommands } from "./register-cli/postgrest-config";

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
  registerInspectCommands(program);
  registerBackupCommands(program);
  registerLifecycleCommands(program);
  registerEnvCommands(program);
}
