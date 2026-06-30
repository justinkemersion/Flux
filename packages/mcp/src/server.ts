/**
 * Flux MCP server (Pass 1 + Pass 2 + Phase 3A audit/intent persistence).
 *
 * Wires the read/preflight/plan/credential tools into an MCP `Server` using the
 * low-level request-handler API. Every tool call emits a stderr audit line and
 * attempts control-plane audit/intent persistence.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { getFluxToolClient } from "./client";
import { buildTools, type FluxToolClient, type ToolDef } from "./tools";
import { assertNonMutatingTools } from "./policy";
import { finalizeToolAudit, type McpPersistenceClient } from "./audit-pipeline";
import { fail, toStableError, type ToolResult } from "./result";

export const FLUX_MCP_NAME = "flux";
export const FLUX_MCP_VERSION = "0.0.1";

/** Build and validate the non-mutating tool set for a given client. */
export function createToolDefs(client: FluxToolClient): ToolDef[] {
  const defs = buildTools(client);
  assertNonMutatingTools(defs);
  return defs;
}

function toCallToolResult(result: ToolResult): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: !result.ok,
  };
}

function persistenceClient(client: FluxToolClient): McpPersistenceClient | undefined {
  if (
    typeof client.recordMcpAuditEvent !== "function" ||
    typeof client.createMcpIntent !== "function"
  ) {
    return undefined;
  }
  return client as McpPersistenceClient;
}

export function createFluxMcpServer(
  client: FluxToolClient = getFluxToolClient(),
): Server {
  const defs = createToolDefs(client);
  const byName = new Map<string, ToolDef>(defs.map((d) => [d.name, d]));
  const persist = persistenceClient(client);

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
      try {
        await finalizeToolAudit({
          event: {
            tool: name,
            intentClass: "read",
            decision: "deny",
            status: "error",
            durationMs: Date.now() - start,
            args,
            errorCode: "unknown_tool",
          },
          args,
          ...(persist ? { client: persist } : {}),
        });
      } catch (err) {
        const stable = toStableError(err);
        return toCallToolResult(
          fail(stable.message, stable.remediation ? { remediation: stable.remediation } : undefined),
        );
      }
      return toCallToolResult(
        fail(`Unknown tool: ${name}`, {
          remediation: "Call tools/list to see available Flux tools.",
        }),
      );
    }

    try {
      const result = await def.handler(args);
      await finalizeToolAudit({
        event: {
          tool: name,
          intentClass: def.intentClass,
          decision: "allow",
          status: result.ok ? "ok" : "error",
          durationMs: Date.now() - start,
          args,
        },
        args,
        result,
        ...(persist ? { client: persist } : {}),
      });
      return toCallToolResult(result);
    } catch (err) {
      const stable = toStableError(err);
      try {
        await finalizeToolAudit({
          event: {
            tool: name,
            intentClass: def.intentClass,
            decision: "allow",
            status: "error",
            durationMs: Date.now() - start,
            args,
            errorCode: stable.code,
          },
          args,
          ...(persist ? { client: persist } : {}),
        });
      } catch (persistErr) {
        const persistStable = toStableError(persistErr);
        return toCallToolResult(
          fail(
            persistStable.message,
            persistStable.remediation ? { remediation: persistStable.remediation } : undefined,
          ),
        );
      }
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
