import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Minimal `KEY=value` parser for a local `.env` file. No interpolation, no
 * exports, no escapes. Intended for resolving a single secret (e.g.
 * `FLUX_GATEWAY_JWT_SECRET`) without taking a `dotenv` dependency.
 *
 * Supported syntax (one entry per line):
 *   KEY=value
 *   KEY="value with spaces"
 *   KEY='value with spaces'
 *   # comments and blank lines are ignored
 *   KEY= (empty values are kept as "")
 *
 * Lines without an `=` are silently ignored. The first occurrence of a key wins.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || /\s/.test(key)) continue;
    if (key in out) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Reads `<cwd>/.env` and returns the parsed map. Returns `{}` if the file is
 * absent or unreadable — callers should treat this as "no values" and fall
 * through to other sources (process.env, prompts, errors).
 */
export async function readEnvFile(cwd: string): Promise<Record<string, string>> {
  try {
    const text = await readFile(join(cwd, ".env"), "utf8");
    return parseEnvFile(text);
  } catch {
    return {};
  }
}
