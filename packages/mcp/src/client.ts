/**
 * Control-plane client wiring for the Flux MCP server.
 *
 * Reuses the exact same `ApiClient` as the `flux` CLI with MCP-specific auth:
 * `FLUX_MCP_TOKEN` → `FLUX_API_TOKEN` → `~/.flux/config.json`.
 */

import { getMcpApiClient, resolveMcpServerToken } from "@flux/cli/api-client";
import type { FluxToolClient } from "./tools";

export function getFluxToolClient(): FluxToolClient {
  return getMcpApiClient();
}

export function isAuthenticated(): boolean {
  return Boolean(resolveMcpServerToken().token);
}
