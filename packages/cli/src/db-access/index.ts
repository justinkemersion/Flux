/**
 * Public entrypoint for Flux database-access tunneling helpers.
 *
 * Exposed as the `@flux/cli/db-access` subpath so internal workspace consumers
 * (e.g. `@flux/mcp`) can open the same SSH tunnel to a tenant database as the
 * `flux db` commands, without duplicating tunnel logic.
 */

export { buildPsqlEnv, openDatabaseTunnel } from "./connect";
export type {
  DbConnectionAuth,
  OpenDbTunnelInput,
  OpenDbTunnelResult,
} from "./connect";
