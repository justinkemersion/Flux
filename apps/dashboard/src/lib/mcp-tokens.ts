/**
 * Dashboard-session MCP token CRUD (Phase 5 Slice C).
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { mcpTokens, projects } from "@/src/db/schema";
import type { McpCapability } from "@/src/lib/mcp-capabilities";
import {
  defaultMcpTokenExpiresAt,
  validateMcpCapabilities,
  validateMcpTokenExpiry,
} from "@/src/lib/mcp-capabilities";
import { generateMcpToken, hashMcpToken } from "@/src/lib/mcp-token-auth";
import {
  extractMcpTokenName,
  sanitizeMcpTokenRow,
  type SafeMcpTokenRecord,
} from "@/src/lib/mcp-token-sanitize";
import type { SystemDb } from "@/src/lib/db";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CreateMcpTokenInput {
  name?: string | null;
  projectIds: string[];
  capabilities: string[];
  expiresAt?: string | null;
  metadata?: Record<string, unknown> | null;
}

export type CreateMcpTokenResult =
  | { ok: true; token: string; tokenRecord: SafeMcpTokenRecord }
  | { ok: false; status: number; error: string };

export type ListMcpTokensResult =
  | { ok: true; tokens: SafeMcpTokenRecord[] }
  | { ok: false; status: number; error: string };

export type RevokeMcpTokenResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

function parseExpiresAt(
  raw: string | null | undefined,
  capabilities: readonly string[],
): { ok: true; expiresAt: Date } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return { ok: true, expiresAt: defaultMcpTokenExpiresAt(capabilities) };
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: "expiresAt must be a valid ISO-8601 timestamp." };
  }
  const validated = validateMcpTokenExpiry(parsed, capabilities);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }
  return { ok: true, expiresAt: parsed };
}

function normalizeProjectIds(projectIds: unknown): string[] | null {
  if (!Array.isArray(projectIds) || projectIds.length === 0) return null;
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of projectIds) {
    if (typeof raw !== "string") return null;
    const id = raw.trim().toLowerCase();
    if (!UUID_RE.test(id)) return null;
    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized.length > 0 ? normalized : null;
}

export function parseCreateMcpTokenBody(
  body: unknown,
): { ok: true; input: CreateMcpTokenInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const record = body as Record<string, unknown>;
  const projectIds = normalizeProjectIds(record.projectIds);
  if (!projectIds) {
    return { ok: false, error: "projectIds must be a non-empty array of project UUIDs." };
  }
  if (!Array.isArray(record.capabilities) || record.capabilities.length === 0) {
    return { ok: false, error: "capabilities must be a non-empty array." };
  }
  const capabilities = record.capabilities.filter((c): c is string => typeof c === "string");
  if (capabilities.length === 0) {
    return { ok: false, error: "capabilities must be a non-empty array." };
  }

  let name: string | undefined;
  if (record.name !== undefined && record.name !== null) {
    if (typeof record.name !== "string" || !record.name.trim()) {
      return { ok: false, error: "name must be a non-empty string when provided." };
    }
    name = record.name.trim().slice(0, 128);
  }

  let metadata: Record<string, unknown> | undefined;
  if (record.metadata !== undefined && record.metadata !== null) {
    if (typeof record.metadata !== "object" || Array.isArray(record.metadata)) {
      return { ok: false, error: "metadata must be a JSON object when provided." };
    }
    metadata = record.metadata as Record<string, unknown>;
  }

  let expiresAt: string | undefined;
  if (record.expiresAt !== undefined && record.expiresAt !== null) {
    if (typeof record.expiresAt !== "string" || !record.expiresAt.trim()) {
      return { ok: false, error: "expiresAt must be an ISO-8601 string when provided." };
    }
    expiresAt = record.expiresAt.trim();
  }

  return {
    ok: true,
    input: {
      name,
      projectIds,
      capabilities,
      expiresAt,
      metadata,
    },
  };
}

async function assertOwnedProjectIds(
  db: SystemDb,
  userId: string,
  projectIds: string[],
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.userId, userId), inArray(projects.id, projectIds)));

  if (rows.length !== projectIds.length) {
    return {
      ok: false,
      status: 403,
      error: "One or more projectIds are not owned by the current user.",
    };
  }
  return { ok: true };
}

function buildStoredMetadata(
  input: CreateMcpTokenInput,
): Record<string, unknown> {
  const base =
    input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? { ...input.metadata }
      : {};
  if (input.name) {
    base.name = input.name;
  }
  delete base.token;
  delete base.keyHash;
  delete base.key_hash;
  return base;
}

export async function createMcpTokenForUser(
  db: SystemDb,
  userId: string,
  input: CreateMcpTokenInput,
): Promise<CreateMcpTokenResult> {
  const caps = validateMcpCapabilities(input.capabilities);
  if (!caps.ok) {
    return { ok: false, status: 400, error: caps.error };
  }

  const owned = await assertOwnedProjectIds(db, userId, input.projectIds);
  if (!owned.ok) {
    return { ok: false, status: owned.status, error: owned.error };
  }

  const expiry = parseExpiresAt(input.expiresAt, caps.capabilities);
  if (!expiry.ok) {
    return { ok: false, status: 400, error: expiry.error };
  }

  const issued = generateMcpToken();
  const metadata = buildStoredMetadata(input);

  const [row] = await db
    .insert(mcpTokens)
    .values({
      userId,
      keyHash: issued.keyHash,
      keyId: issued.keyId,
      keyPreview: issued.keyPreview,
      projectIds: input.projectIds,
      capabilities: caps.capabilities,
      expiresAt: expiry.expiresAt,
      metadata,
    })
    .returning({
      id: mcpTokens.id,
      keyId: mcpTokens.keyId,
      keyPreview: mcpTokens.keyPreview,
      projectIds: mcpTokens.projectIds,
      capabilities: mcpTokens.capabilities,
      expiresAt: mcpTokens.expiresAt,
      revokedAt: mcpTokens.revokedAt,
      createdAt: mcpTokens.createdAt,
      lastUsedAt: mcpTokens.lastUsedAt,
      metadata: mcpTokens.metadata,
    });

  if (!row) {
    return { ok: false, status: 500, error: "Could not create MCP token." };
  }

  return {
    ok: true,
    token: issued.token,
    tokenRecord: sanitizeMcpTokenRow(row),
  };
}

export async function listMcpTokensForUser(
  db: SystemDb,
  userId: string,
): Promise<ListMcpTokensResult> {
  const rows = await db
    .select({
      id: mcpTokens.id,
      keyId: mcpTokens.keyId,
      keyPreview: mcpTokens.keyPreview,
      projectIds: mcpTokens.projectIds,
      capabilities: mcpTokens.capabilities,
      expiresAt: mcpTokens.expiresAt,
      revokedAt: mcpTokens.revokedAt,
      createdAt: mcpTokens.createdAt,
      lastUsedAt: mcpTokens.lastUsedAt,
      metadata: mcpTokens.metadata,
    })
    .from(mcpTokens)
    .where(eq(mcpTokens.userId, userId))
    .orderBy(desc(mcpTokens.createdAt));

  return {
    ok: true,
    tokens: rows.map((row) => sanitizeMcpTokenRow(row)),
  };
}

export async function revokeMcpTokenForUser(
  db: SystemDb,
  userId: string,
  tokenId: string,
): Promise<RevokeMcpTokenResult> {
  const id = tokenId.trim();
  if (!UUID_RE.test(id)) {
    return { ok: false, status: 400, error: "Token id must be a UUID." };
  }

  const [existing] = await db
    .select({ id: mcpTokens.id, revokedAt: mcpTokens.revokedAt })
    .from(mcpTokens)
    .where(and(eq(mcpTokens.id, id), eq(mcpTokens.userId, userId)))
    .limit(1);

  if (!existing) {
    return { ok: false, status: 404, error: "MCP token not found." };
  }
  if (existing.revokedAt) {
    return { ok: true };
  }

  await db
    .update(mcpTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(mcpTokens.id, id), eq(mcpTokens.userId, userId), isNull(mcpTokens.revokedAt)));

  return { ok: true };
}

/** Test helper: verify DB row stores hash only. */
export function mcpTokenRowStoresHashOnly(keyHash: string, plaintext: string): boolean {
  return keyHash === hashMcpToken(plaintext) && keyHash.length === 64;
}

export type { McpCapability, SafeMcpTokenRecord };
