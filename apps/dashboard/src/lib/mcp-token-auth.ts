import { createHash, randomBytes } from "node:crypto";

/** Scoped MCP key family — distinct from `flx_live`. */
export const FLUX_MCP_KEY_PREFIX = "flx_mcp" as const;

/** `flx_mcp_<12 hex keyId>_<20 hex secret>_<4 hex checksum>` */
export const FLUX_MCP_TOKEN_REGEX =
  /^flx_mcp_([a-f0-9]{12})_([a-f0-9]{20})_([a-f0-9]{4})$/i;

export interface ParsedMcpToken {
  keyId: string;
  secret: string;
}

export function checksumForMcpTokenMaterial(keyIdLower: string, secretLower: string): string {
  return createHash("sha256")
    .update(`${FLUX_MCP_KEY_PREFIX}_${keyIdLower}_${secretLower}`, "utf8")
    .digest("hex")
    .slice(0, 4)
    .toLowerCase();
}

export function parseMcpToken(token: string): ParsedMcpToken | null {
  const m = token.trim().match(FLUX_MCP_TOKEN_REGEX);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const keyId = m[1].toLowerCase();
  const secret = m[2].toLowerCase();
  const expected = checksumForMcpTokenMaterial(keyId, secret);
  if (m[3].toLowerCase() !== expected) return null;
  return { keyId, secret };
}

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token.trim(), "utf8").digest("hex");
}

export function previewMcpTokenFromParts(keyId: string, secret: string): string {
  const tail = secret.slice(-4).toLowerCase();
  const head = keyId.slice(0, 4).toLowerCase();
  return `${FLUX_MCP_KEY_PREFIX}_${head}…${tail}`;
}

export function previewMcpToken(token: string): string | null {
  const parsed = parseMcpToken(token);
  if (!parsed) return null;
  return previewMcpTokenFromParts(parsed.keyId, parsed.secret);
}

export function isMcpTokenLike(token: string): boolean {
  const trimmed = token.trim();
  return trimmed.startsWith(`${FLUX_MCP_KEY_PREFIX}_`);
}

export interface GeneratedMcpToken {
  token: string;
  keyId: string;
  keyPreview: string;
  keyHash: string;
}

/** Issue a new MCP token (show once; persist only {@link hashMcpToken}). */
export function generateMcpToken(): GeneratedMcpToken {
  const keyId = randomBytes(6).toString("hex").toLowerCase();
  const secret = randomBytes(10).toString("hex").toLowerCase();
  const checksum = checksumForMcpTokenMaterial(keyId, secret);
  const token = `${FLUX_MCP_KEY_PREFIX}_${keyId}_${secret}_${checksum}`;
  return {
    token,
    keyId,
    keyPreview: previewMcpTokenFromParts(keyId, secret),
    keyHash: hashMcpToken(token),
  };
}
