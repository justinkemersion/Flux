export type ServerStatus =
  | "running"
  | "stopped"
  | "partial"
  | "missing"
  | "corrupted";

export type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  /** Catalog / Docker stack hash (7 hex), required for CLI `--hash` and hostnames. */
  hash: string;
  /** When omitted, UI assumes v1_dedicated (legacy list payloads). */
  mode?: "v1_dedicated" | "v2_shared";
  status: ServerStatus;
  apiUrl: string;
  createdAt: string;
  /** Mesh probe (2m) — from flux-system. */
  healthStatus?: string | null;
  lastHeartbeatAt?: string | null;
  /** Loaded only after "Reveal keys" — not returned by list API. */
  anonKey?: string | null;
  serviceRoleKey?: string | null;
  postgresConnectionString?: string | null;
};
