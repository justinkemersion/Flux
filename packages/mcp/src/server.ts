/**
 * Flux MCP server (Pass 1 + Pass 2 + Phase 3A audit/intent + Phase 3B protective mutation).
 *
 * Wires read/preflight/plan/credential/protective tools into an MCP `Server`.
 * Every tool call emits a stderr audit line and attempts control-plane audit/intent persistence.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { getFluxToolClient } from "./client";
import {
  buildTools,
  type FluxToolClient,
  type ProtectiveMutationContext,
  type ToolDef,
} from "./tools";
import {
  assertProtectiveMutationPolicy,
  assertRegisteredToolsPolicy,
  isProtectiveMutationIntent,
} from "./policy";
import { finalizeToolAudit, type McpPersistenceClient } from "./audit-pipeline";
import {
  backupEnsureGateFromResult,
  createPendingProtectiveIntent,
  intentFinalizationFailureResult,
  isProtectivePersistenceAvailable,
  updateProtectiveIntentTerminal,
  type ProtectivePersistenceClient,
} from "./protective-mutation";
import { fail, toStableError, type ToolResult } from "./result";

export const FLUX_MCP_NAME = "flux";
export const FLUX_MCP_VERSION = "0.0.1";

/** Build and validate the registered tool set for a given client. */
export function createToolDefs(client: FluxToolClient): ToolDef[] {
  const defs = buildTools(client);
  assertRegisteredToolsPolicy(defs);
  return defs;
}

function toCallToolResult(result: ToolResult): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: !result.ok,
  };
}

function persistenceClient(client: FluxToolClient): McpPersistenceClient | undefined {
  if (typeof client.recordMcpAuditEvent !== "function") {
    return undefined;
  }
  return client as McpPersistenceClient;
}

async function runProtectiveMutationTool(
  def: ToolDef,
  args: Record<string, unknown>,
  client: FluxToolClient,
): Promise<{ result: ToolResult; gate?: string; intentId?: string; errorCode?: string }> {
  if (!isProtectivePersistenceAvailable(client)) {
    return {
      result: fail(
        "Persistent MCP audit/intent persistence is unavailable; protective mutation tools are blocked.",
        {
          remediation:
            "Ensure the MCP server is connected to a control plane with audit and intent APIs, and FLUX_API_TOKEN is set.",
        },
      ),
      errorCode: "upstream_error",
    };
  }

  const protectiveClient = client as ProtectivePersistenceClient;
  let intentId: string;

  try {
    const pending = await createPendingProtectiveIntent(protectiveClient, def, args);
    intentId = pending.intentId;
  } catch (err) {
    const stable = toStableError(err);
    return {
      result: fail(
        `Persistent MCP intent required but unavailable: ${stable.message}`,
        stable.remediation ? { remediation: stable.remediation } : undefined,
      ),
      errorCode: stable.code,
    };
  }

  const policy = assertProtectiveMutationPolicy({
    auditAvailable: true,
    intentRecorded: true,
  });
  if (!policy.allowed) {
    return {
      result: fail(policy.reason, {
        remediation:
          "Resolve MCP audit/intent persistence before running protective mutation tools.",
      }),
      intentId,
      errorCode: "upstream_error",
    };
  }

  const ctx: ProtectiveMutationContext = { intentId };
  let handlerResult: ToolResult;
  try {
    handlerResult = await def.handler(args, ctx);
  } catch (err) {
    const stable = toStableError(err);
    handlerResult = fail(
      stable.message,
      stable.remediation ? { remediation: stable.remediation } : undefined,
    );
    try {
      await updateProtectiveIntentTerminal(
        protectiveClient,
        intentId,
        handlerResult,
        stable.code,
      );
    } catch {
      // Intent update failure after handler error — still surface handler error.
    }
    return {
      result: handlerResult,
      intentId,
      ...(def.name === "flux.backup.ensureVerified"
        ? { gate: "backup_ensure_failed" as const }
        : {}),
      errorCode: stable.code,
    };
  }

  let finalResult = handlerResult;
  try {
    await updateProtectiveIntentTerminal(protectiveClient, intentId, handlerResult);
  } catch {
    finalResult = intentFinalizationFailureResult(handlerResult, intentId);
  }

  const gate =
    def.name === "flux.backup.ensureVerified"
      ? backupEnsureGateFromResult(finalResult)
      : undefined;

  return {
    result: finalResult,
    intentId,
    ...(gate !== undefined ? { gate } : {}),
  };
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

    if (isProtectiveMutationIntent(def.intentClass)) {
      const run = await runProtectiveMutationTool(def, args, client);
      try {
        await finalizeToolAudit({
          event: {
            tool: name,
            intentClass: def.intentClass,
            decision: "allow",
            status: run.result.ok ? "ok" : "error",
            durationMs: Date.now() - start,
            args,
            ...(run.errorCode !== undefined ? { errorCode: run.errorCode } : {}),
            skipIntentCreate: true,
            ...(run.gate !== undefined ? { gate: run.gate } : {}),
            ...(run.intentId !== undefined ? { intentId: run.intentId } : {}),
          },
          args,
          result: run.result,
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
      return toCallToolResult(run.result);
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
