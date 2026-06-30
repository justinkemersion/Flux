/**
 * Shared secret-leak detection for MCP tool outputs and smoke probes.
 */

const LEAK_PATTERNS: readonly RegExp[] = [
  /\/srv\//,
  /\/tmp\/flux-mcp-/,
  /primaryArtifact/i,
  /offsiteKey/i,
  /offsiteBucket/i,
  /\bflx_live_[a-f0-9]{20,}/i,
  /\bflx_mcp_[a-f0-9]{12}_[a-f0-9]{20}_[a-f0-9]{4}\b/i,
  /eyJ[A-Za-z0-9_-]{10,}\./,
  /postgres:\/\//,
  /https?:\/\/[^\s"']+\?[^"']*signature/i,
  /"password"\s*:\s*"[^"]{8,}"/i,
  /PGRST_JWT_SECRET/i,
];

export function assertNoSecretLeaks(label: string, payload: unknown): void {
  const text = JSON.stringify(payload);
  for (const pattern of LEAK_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(`${label}: output may leak sensitive data (matched ${String(pattern)})`);
    }
  }
}

export function containsSecretLeak(payload: unknown): boolean {
  try {
    assertNoSecretLeaks("payload", payload);
    return false;
  } catch {
    return true;
  }
}
