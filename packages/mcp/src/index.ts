#!/usr/bin/env node
/**
 * Flux MCP server entrypoint (stdio transport).
 *
 * Thin process wiring only: build the server, connect stdio, fail loudly on a
 * fatal startup error. All logging goes to stderr (stdout is the MCP stream).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { bootstrapMcpAuth } from "./auth";
import { createFluxMcpServer, FLUX_MCP_NAME, FLUX_MCP_VERSION } from "./server";

async function main(): Promise<void> {
  bootstrapMcpAuth();
  const server = createFluxMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[flux-mcp] ${FLUX_MCP_NAME} v${FLUX_MCP_VERSION} ready (stdio).\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`[flux-mcp] fatal: ${String(err)}\n`);
  process.exit(1);
});
