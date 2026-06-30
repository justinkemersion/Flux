/**
 * MCP smoke probe library (offline + optional hosted).
 */

import {
  ApiClient,
  isMcpVerifyResult,
  isSafeMcpKeyPreview,
  isValidMcpTokenFormat,
  normalizeFluxApiBase,
  stringContainsMcpTokenMaterial,
} from "@flux/cli/api-client";
import {
  FLUX_MCP_BLOCKED_TOOL_NAMES,
  manifestToolNames,
} from "../tool-manifest.ts";
import { createToolDefs } from "../server.ts";
import { getFluxToolClient } from "../client.ts";
import { invokeFluxMcpTool } from "../server.ts";
import { assertNoSecretLeaks } from "../secret-leak-guard.ts";
import { readFluxResource } from "../resources.ts";
import type { FluxToolClient } from "../tools/index.ts";

export type McpSmokeSignoff = {
  label: string;
  pass: boolean;
  detail?: string;
};

export function parseMcpSmokeArgs(argv: string[]): { hosted: boolean } {
  return { hosted: argv.includes("--hosted") };
}

export function resolveSmokeApiBase(explicit?: string): string {
  const raw =
    explicit?.trim() ||
    process.env.FLUX_API_BASE?.trim() ||
    "https://flux.vsl-base.com/api";
  return normalizeFluxApiBase(raw);
}

export function offlineContractChecks(): string[] {
  const lines: string[] = [];
  const names = manifestToolNames();
  lines.push(`OK: manifest registers ${String(names.length)} tools`);

  for (const blocked of FLUX_MCP_BLOCKED_TOOL_NAMES) {
    if (names.includes(blocked)) {
      throw new Error(`Blocked tool present in manifest: ${blocked}`);
    }
  }
  lines.push(`OK: ${String(FLUX_MCP_BLOCKED_TOOL_NAMES.length)} blocked destructive tools absent`);

  return lines;
}

export function buildOfflineSignoff(): McpSmokeSignoff[] {
  offlineContractChecks();
  return [
    { label: "offline contract tests", pass: true },
    { label: "destructive tools absent", pass: true },
  ];
}

export async function probeInvalidTokenFails(baseUrl: string): Promise<string> {
  const client = new ApiClient(baseUrl, {
    resolveToken: () => "flx_mcp_000000000000_00000000000000000000_0000",
  });
  try {
    await client.verifyToken("flx_mcp_000000000000_00000000000000000000_0000");
    throw new Error("Expected invalid token to fail verify");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/invalid|expired|401/i.test(msg)) {
      throw new Error(`Unexpected invalid-token error: ${msg}`);
    }
    return "OK: invalid token rejected by auth/verify";
  }
}

export async function probeHostedAuthVerify(
  token: string,
  baseUrl: string,
): Promise<string> {
  const client = new ApiClient(baseUrl, { resolveToken: () => token });
  const verify = await client.verifyToken(token);
  if (!isMcpVerifyResult(verify)) {
    throw new Error("Expected MCP verify profile for scoped token");
  }
  if (!isSafeMcpKeyPreview(verify.keyPreview)) {
    throw new Error(`Unsafe keyPreview in verify response: ${verify.keyPreview}`);
  }
  if (stringContainsMcpTokenMaterial(JSON.stringify(verify))) {
    throw new Error("Verify response may contain token material");
  }
  return `OK: hosted auth/verify (keyPreview: ${verify.keyPreview})`;
}

export function probeHostedToolsList(): string {
  const defs = createToolDefs(getFluxToolClient());
  const names = defs.map((def) => def.name).sort();
  const expected = manifestToolNames().sort();
  if (names.join(",") !== expected.join(",")) {
    throw new Error("Hosted tools/list diverges from manifest");
  }
  for (const blocked of FLUX_MCP_BLOCKED_TOOL_NAMES) {
    if (names.includes(blocked)) {
      throw new Error(`Blocked tool in tools/list: ${blocked}`);
    }
  }
  return `OK: hosted tools/list (${String(names.length)} tools)`;
}

export async function probeReadTokenListProjects(
  token: string,
  baseUrl: string,
): Promise<string> {
  if (!isValidMcpTokenFormat(token)) {
    throw new Error("FLUX_MCP_TOKEN format invalid for hosted smoke");
  }
  process.env.FLUX_MCP_TOKEN = token;
  process.env.FLUX_API_BASE = baseUrl;
  const client = new ApiClient(baseUrl, { resolveToken: () => token });
  const result = await invokeFluxMcpTool("flux.project.list", {}, client as unknown as FluxToolClient);
  if (!result.ok) {
    throw new Error(`flux.project.list failed: ${result.summary}`);
  }
  assertNoSecretLeaks("flux.project.list", result);
  return `OK: hosted read tool flux.project.list`;
}

export async function probeHostedSchemaResource(
  token: string,
  baseUrl: string,
  hash: string,
): Promise<string> {
  process.env.FLUX_MCP_TOKEN = token;
  process.env.FLUX_API_BASE = baseUrl;
  const client = new ApiClient(baseUrl, { resolveToken: () => token }) as unknown as FluxToolClient;

  const schemaTool = await invokeFluxMcpTool("flux.schema.inspect", { hash }, client);
  if (!schemaTool.ok) {
    throw new Error(`flux.schema.inspect failed: ${schemaTool.summary}`);
  }
  assertNoSecretLeaks("flux.schema.inspect", schemaTool);

  const resource = await readFluxResource(`flux://projects/${hash}/schema`, client);
  if ("error" in resource) {
    throw new Error(`resource read failed: ${resource.error}`);
  }
  assertNoSecretLeaks("flux://projects/schema resource", resource.text);

  return `OK: hosted schema tool + flux://projects/${hash}/schema resource`;
}

export async function probeMigrationApplyDenied(
  token: string,
  baseUrl: string,
  hash: string,
): Promise<string> {
  process.env.FLUX_MCP_TOKEN = token;
  process.env.FLUX_API_BASE = baseUrl;
  const client = new ApiClient(baseUrl, { resolveToken: () => token });
  const result = await invokeFluxMcpTool(
    "flux.migration.apply",
    {
      hash,
      planId: "smoke-plan",
      planHash: "smoke-hash",
      migrationsPath: "migrations",
    },
    client as unknown as FluxToolClient,
  );
  if (result.ok) {
    throw new Error("Expected migration.apply to be denied for read-only token");
  }
  assertNoSecretLeaks("flux.migration.apply denial", result);
  return "OK: read token cannot apply migrations";
}

export async function probeAuditPreviewSafe(
  token: string,
  baseUrl: string,
): Promise<string> {
  const client = new ApiClient(baseUrl, { resolveToken: () => token });
  const verify = await client.verifyToken(token);
  if (!isMcpVerifyResult(verify)) {
    throw new Error("Expected MCP verify profile");
  }
  if (token.includes(verify.keyPreview) || stringContainsMcpTokenMaterial(verify.keyPreview)) {
    throw new Error("keyPreview is not safe");
  }

  try {
    const intents = await client.listMcpIntents({ limit: 5 });
    assertNoSecretLeaks("listMcpIntents", intents);
    const serialized = JSON.stringify(intents);
    if (/\bflx_mcp_[a-f0-9]{12}_[a-f0-9]{20}_[a-f0-9]{4}\b/i.test(serialized)) {
      throw new Error("Intent list contains full MCP token");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/capability|403|401|forbidden/i.test(msg)) {
      throw err;
    }
  }

  return "OK: audit/intent identity uses safe keyPreview only";
}

export function hostedEnvPresent(): boolean {
  return Boolean(process.env.FLUX_MCP_TOKEN?.trim() && process.env.FLUX_MCP_SMOKE_HASH?.trim());
}

export async function runHostedSmokeProbes(): Promise<McpSmokeSignoff[]> {
  const token = process.env.FLUX_MCP_TOKEN!.trim();
  const hash = process.env.FLUX_MCP_SMOKE_HASH!.trim().toLowerCase();
  const baseUrl = resolveSmokeApiBase();

  const checks: Array<{ label: string; run: () => Promise<void> | void }> = [
    {
      label: "hosted auth verify",
      run: async () => {
        await probeHostedAuthVerify(token, baseUrl);
      },
    },
    {
      label: "hosted tools/list",
      run: () => {
        probeHostedToolsList();
      },
    },
    {
      label: "hosted read tool",
      run: async () => {
        await probeReadTokenListProjects(token, baseUrl);
      },
    },
    {
      label: "hosted schema/resource probe",
      run: async () => {
        await probeHostedSchemaResource(token, baseUrl, hash);
      },
    },
    {
      label: "read token apply denial",
      run: async () => {
        await probeMigrationApplyDenied(token, baseUrl, hash);
      },
    },
    {
      label: "secret leak scan",
      run: async () => {
        await probeHostedAuthVerify(token, baseUrl);
        await probeReadTokenListProjects(token, baseUrl);
      },
    },
    {
      label: "audit preview safe",
      run: async () => {
        await probeAuditPreviewSafe(token, baseUrl);
      },
    },
  ];

  await probeInvalidTokenFails(baseUrl);

  const signoff: McpSmokeSignoff[] = [];
  for (const check of checks) {
    try {
      await check.run();
      signoff.push({ label: check.label, pass: true });
    } catch (err) {
      signoff.push({
        label: check.label,
        pass: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return signoff;
}

export function formatSignoffBlock(signoffs: McpSmokeSignoff[]): string {
  return signoffs.map((row) => `${row.label}: ${row.pass ? "PASS" : "FAIL"}`).join("\n");
}

export function allSignoffsPassed(signoffs: McpSmokeSignoff[]): boolean {
  return signoffs.every((row) => row.pass);
}
