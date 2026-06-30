/**
 * Sanitize MCP intent rows for dashboard / operator list APIs.
 * Never expose raw SQL, paths, credentials, tokens, signed URLs, or backup storage fields.
 */

import type { McpIntentClass, McpResultStatus } from "./mcp-audit";
import type { McpIntentStatus, McpRiskLevel } from "./mcp-intents";

const SENSITIVE_KEY_RE =
  /(token|secret|password|passwd|pwd|jwt|authorization|auth|api[_-]?key|anon[_-]?key|service[_-]?role|credential|bearer|\bkey\b|signed|offsite|bucket|provider|artifact|volume|checksum|reconciled)/i;

const STORAGE_KEY_RE =
  /(path|artifact|volume|offsite|bucket|signed|url|etag|checksum|local|provider|reconciled|password|secret|credential)/i;

const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/;
const CONNECTION_STRING_RE =
  /\b(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s:@/]+:[^\s@/]+@/i;
const FLX_LIVE_KEY_RE = /\bflx_live_[a-f0-9]{32}_[a-f0-9]{4}\b/i;
const PATH_LIKE_VALUE_RE =
  /(\/srv\/|\/var\/|\/app\/|\/home\/|\/tmp\/|primaryArtifact|\.dump\b|offsiteKey|backupVolume|\\)/i;
const ABSOLUTE_PATH_RE = /^([A-Za-z]:\\|\/)/;
const SQL_STATEMENT_RE =
  /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE|SELECT)\b/i;

const REDACTED = "[redacted]";

/** Safe metadata keys persisted by Flux MCP tools (Phase 4 / 4B). */
const METADATA_ALLOWLIST = new Set([
  "access",
  "allowed",
  "applyCount",
  "appliedCount",
  "appliedFiles",
  "backupTrustTier",
  "backupId",
  "changedFiles",
  "created",
  "destructiveShaped",
  "detail",
  "failedFile",
  "failureIndex",
  "gate",
  "intentId",
  "missingFiles",
  "partialApply",
  "planHash",
  "platformBackupCompliant",
  "remainingFiles",
  "rowCap",
  "staleReason",
  "statementTimeoutMs",
  "tier",
  "trustTier",
  "ttlSeconds",
  "verified",
]);

/** Safe request-summary keys for operator visibility. */
const SUMMARY_ALLOWLIST = new Set([
  "allowDestructive",
  "empty",
  "hash",
  "maxAgeHours",
  "planHash",
  "planId",
  "reason",
  "requireVerifiedBackup",
  "rowCap",
  "slug",
  "statementTimeoutMs",
  "tool",
  "ttlSeconds",
  "verifyLatestIfFresh",
  "wait",
]);

export interface SanitizedMcpIntent {
  id: string;
  createdAt: string;
  updatedAt: string;
  projectHash: string | null;
  tool: string;
  intentClass: McpIntentClass;
  status: McpIntentStatus;
  riskLevel: McpRiskLevel;
  policyDecision: string;
  approvalStatus: string | null;
  resultStatus: McpResultStatus | null;
  errorCode: string | null;
  planId: string | null;
  planHash: string | null;
  summary: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
}

export interface McpIntentRowForSanitize {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  projectHash: string | null;
  tool: string;
  intentClass: string;
  status: string;
  riskLevel: string;
  policyDecision: string;
  approvalStatus: string | null;
  resultStatus: string | null;
  errorCode: string | null;
  planId: string | null;
  planHash: string | null;
  requestSummary: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
}

function redactString(value: string, keyPath: string): string {
  if (SENSITIVE_KEY_RE.test(keyPath)) return REDACTED;
  if (keyPath === "sql" || keyPath.endsWith(".sql")) return REDACTED;
  if (keyPath === "workspaceRoot" || keyPath.endsWith("workspaceRoot")) return REDACTED;
  if (keyPath === "migrationsPath" || keyPath.endsWith("migrationsPath")) {
    return ABSOLUTE_PATH_RE.test(value) || PATH_LIKE_VALUE_RE.test(value) ? REDACTED : value;
  }
  if (JWT_RE.test(value)) return REDACTED;
  if (CONNECTION_STRING_RE.test(value)) return REDACTED;
  if (FLX_LIVE_KEY_RE.test(value)) return REDACTED;
  if (/^Bearer\s+\S+/i.test(value)) return REDACTED;
  if (PATH_LIKE_VALUE_RE.test(value)) return REDACTED;
  if (ABSOLUTE_PATH_RE.test(value)) return REDACTED;
  if (SQL_STATEMENT_RE.test(value) && value.length > 40) return REDACTED;
  return value;
}

function deepRedactValue(value: unknown, keyPath = ""): unknown {
  if (typeof value === "string") {
    return redactString(value, keyPath);
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => deepRedactValue(item, `${keyPath}[${String(i)}]`));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const path = keyPath ? `${keyPath}.${key}` : key;
      if (SENSITIVE_KEY_RE.test(key) || STORAGE_KEY_RE.test(key)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = deepRedactValue(val, path);
    }
    return out;
  }
  return value;
}

export function sanitizeIntentMetadata(
  metadata: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (metadata === null) return null;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(metadata)) {
    if (!METADATA_ALLOWLIST.has(key)) continue;
    if (STORAGE_KEY_RE.test(key)) continue;
    out[key] = deepRedactValue(val, key);
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function sanitizeIntentRequestSummary(
  requestSummary: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(requestSummary)) {
    if (!SUMMARY_ALLOWLIST.has(key)) continue;
    out[key] = deepRedactValue(val, key);
  }
  if (requestSummary.migrationsPath !== undefined) {
    const raw = requestSummary.migrationsPath;
    if (typeof raw === "string") {
      out.migrationsPath =
        ABSOLUTE_PATH_RE.test(raw) || PATH_LIKE_VALUE_RE.test(raw) ? REDACTED : raw;
    } else {
      out.migrationsPath = REDACTED;
    }
  }
  return out;
}

export function sanitizeMcpIntentRow(row: McpIntentRowForSanitize): SanitizedMcpIntent {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    projectHash: row.projectHash,
    tool: row.tool,
    intentClass: row.intentClass as McpIntentClass,
    status: row.status as McpIntentStatus,
    riskLevel: row.riskLevel as McpRiskLevel,
    policyDecision: row.policyDecision,
    approvalStatus: row.approvalStatus,
    resultStatus:
      row.resultStatus === "ok" || row.resultStatus === "error"
        ? row.resultStatus
        : null,
    errorCode: row.errorCode,
    planId: row.planId,
    planHash: row.planHash,
    summary: sanitizeIntentRequestSummary(row.requestSummary),
    metadata: sanitizeIntentMetadata(row.metadata),
  };
}

/** Test helper: true when serialized payload contains forbidden intent leakage. */
export function containsIntentLeak(value: unknown): boolean {
  const text = JSON.stringify(value);
  const forbidden = [
    /"requestSummary"/,
    /CREATE TABLE/i,
    /postgres:\/\//i,
    /flx_live_/i,
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    /\/srv\//,
    /\/home\//,
    /primaryArtifact/,
    /offsiteKey/,
    /signedUrl/i,
    /"password"\s*:\s*"/,
    /"workspaceRoot"\s*:\s*"\/tmp/,
  ];
  return forbidden.some((re) => re.test(text));
}
