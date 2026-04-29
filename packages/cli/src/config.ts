import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".flux");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export type FluxConfig = {
  token: string;
  profile?: {
    plan: "hobby" | "pro";
    defaultMode: "v1_dedicated" | "v2_shared";
  };
};

/**
 * Local CLI credentials (JSON). Preferred override: `FLUX_API_TOKEN` env.
 */
export function loadConfig(): FluxConfig | null {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return null;
    }
    const raw = readFileSync(CONFIG_FILE, "utf8");
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== "object" || !("token" in j)) {
      return null;
    }
    const t = (j as { token: unknown }).token;
    if (typeof t !== "string" || !t.trim()) {
      return null;
    }
    const profileRaw =
      "profile" in j
        ? (j as { profile?: unknown }).profile
        : undefined;
    let profile: FluxConfig["profile"];
    if (profileRaw && typeof profileRaw === "object") {
      const plan = (profileRaw as { plan?: unknown }).plan;
      const defaultMode = (profileRaw as { defaultMode?: unknown }).defaultMode;
      if (
        (plan === "hobby" || plan === "pro") &&
        (defaultMode === "v1_dedicated" || defaultMode === "v2_shared")
      ) {
        profile = { plan, defaultMode };
      }
    }
    return { token: t.trim(), ...(profile ? { profile } : {}) };
  } catch {
    return null;
  }
}

/**
 * Writes `~/.flux/config.json` with mode 0600 (best effort).
 */
export function saveConfig(config: {
  token: string;
  profile?: FluxConfig["profile"];
}): void {
  const token = config.token.trim();
  if (!token) {
    throw new Error("Token is empty.");
  }
  const payload: FluxConfig = { token };
  if (config.profile) {
    payload.profile = config.profile;
  }
  mkdirSync(CONFIG_DIR, { mode: 0o700, recursive: true });
  writeFileSync(
    CONFIG_FILE,
    `${JSON.stringify(payload, null, 2)}\n`,
    { mode: 0o600 },
  );
  void chmod(CONFIG_FILE, 0o600).catch(() => {
    /* ignore */
  });
}

/**
 * Control-plane token: `FLUX_API_TOKEN` wins, then `~/.flux/config.json`.
 */
export function resolveFluxApiToken(): string | undefined {
  const fromEnv = process.env.FLUX_API_TOKEN?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return loadConfig()?.token;
}
