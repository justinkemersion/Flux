/**
 * Control-plane client wiring for the Flux MCP server.
 *
 * Reuses the exact same `ApiClient` and auth/config resolution as the `flux`
 * CLI (`FLUX_API_TOKEN` env, then `~/.flux/config.json`). No HTTP logic is
 * duplicated here.
 */

import { getApiClient, resolveFluxApiToken } from "@flux/cli/api-client";
import type { FluxToolClient } from "./tools";

export function getFluxToolClient(): FluxToolClient {
  return getApiClient();
}

export function isAuthenticated(): boolean {
  return Boolean(resolveFluxApiToken());
}
