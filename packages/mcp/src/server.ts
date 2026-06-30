/**
 * Flux MCP server (Pass 1).
 *
 * Wires the read/preflight tools into an MCP `Server` using the low-level
 * request-handler API (no zod tool schemas, so the package is decoupled from the
 * SDK's zod version). Every tool call is wrapped with audit logging and the
 * standard result envelope; thrown errors are mapped to stable error codes.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { getFluxToolClient } from "./client";
import { buildTools, type FluxToolClient, type ToolDef } from "./tools";
import { assertPass1Tools } from "./policy";
import { emitAudit } from "./audit";
import { fail, toStableError, type ToolResult } from "./result";

export const FLUX_MCP_NAME = "flux";
export const FLUX_MCP_VERSION = "0.0.1";

/** Build and validate the Pass 1 tool set for a given client. */
export function createToolDefs(client: FluxToolClient): ToolDef[] {
  const defs = buildTools(client);
  assertPass1Tools(defs);
  return defs;
}

function toCallToolResult(result: ToolResult): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: !result.ok,
  };
}

export function createFluxMcpServer(
  client: FluxToolClient = getFluxToolClient(),
): Server {
  const defs = createToolDefs(client);
  const byName = new Map<string, ToolDef>(defs.map((d) => [d.name, d]));

  const server = new Server(
    { name: FLUX_MCP_NAME, version: FLUX_MCP_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: defs.map((d) => ({
      name: d.name,
      description: d.description,
      inputSchema: d.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const start = Date.now();
    const def = byName.get(name);

    if (!def) {
      emitAudit({
        tool: name,
        intentClass: "read",
        decision: "deny",
        status: "error",
        durationMs: Date.now() - start,
        args,
        errorCode: "unknown_tool",
      });
      return toCallToolResult(
        fail(`Unknown tool: ${name}`, {
          remediation: "Call tools/list to see available Flux tools.",
        }),
      );
    }

    try {
      const result = await def.handler(args);
      emitAudit({
        tool: name,
        intentClass: def.intentClass,
        decision: "allow",
        status: result.ok ? "ok" : "error",
        durationMs: Date.now() - start,
        args,
      });
      return toCallToolResult(result);
    } catch (err) {
      const stable = toStableError(err);
      emitAudit({
        tool: name,
        intentClass: def.intentClass,
        decision: "allow",
        status: "error",
        durationMs: Date.now() - start,
        args,
        errorCode: stable.code,
      });
      return toCallToolResult(
        fail(
          stable.message,
          stable.remediation !== undefined
            ? { remediation: stable.remediation }
            : undefined,
        ),
      );
    }
  });

  return server;
}
