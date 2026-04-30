export type FluxActivityOptions = {
  /**
   * Control plane origin (no trailing slash), e.g. `https://dashboard.example.com`.
   * The SDK will `POST` to `{controlPlaneUrl}/api/projects/{slug}/activity?hash={hash}`.
   */
  controlPlaneUrl: string;
  /** Must match dashboard `FLUX_ACTIVITY_SECRET`. Prefer server-side env only. */
  secret: string;
  /**
   * Tenant slug. If omitted, inferred from {@link FluxClientOptions.url} when the host matches
   * pooled `api--{slug}--{7hex}.<domain>` (v2_shared), dedicated `api.{slug}.{7hex}.<domain>` (v1),
   * or legacy shapes without a hash segment.
   */
  slug?: string;
  /**
   * Per-project 7-hex tenant hash. Required by the dashboard activity endpoint under global
   * hash namespacing (slug is only unique per user). If omitted, inferred from
   * {@link FluxClientOptions.url}. Without a hash, the SDK silently skips the activity ping.
   */
  hash?: string;
};

export type FluxClientOptions = {
  url: string;
  anonKey?: string;
  /** Optional: bump `last_accessed_at` in flux-system after each successful PostgREST response. */
  activity?: FluxActivityOptions;
};

export type FluxResult<T> = {
  data: T | null;
  error: unknown | null;
};

const FLUX_TENANT_HOST_SUFFIXES = [".vsl-base.com", ".flux.localhost"] as const;

/**
 * Pooled-stack flat label: `api--{slug}--{7hex}` (first DNS label under the tenant domain).
 */
function tryParseFlatApiTenantLabel(label: string): {
  slug: string;
  hash: string;
} | null {
  if (!label.toLowerCase().startsWith("api--")) return null;
  const parts = label.split("--");
  if (parts.length < 3) return null;
  if (parts[0]!.toLowerCase() !== "api") return null;
  const hash = parts[parts.length - 1]!.toLowerCase();
  if (!/^[a-f0-9]{7}$/.test(hash)) return null;
  const slug = parts.slice(1, -1).join("--");
  if (!slug) return null;
  return { slug, hash };
}

function extractFluxTenantHostSubdomain(baseUrl: string): string | null {
  let s = baseUrl.trim();
  if (!/^[a-z]+:/i.test(s)) {
    s = `http://${s}`;
  }
  try {
    const { hostname } = new URL(s);
    for (const suffix of FLUX_TENANT_HOST_SUFFIXES) {
      if (hostname.endsWith(suffix) && hostname.length > suffix.length) {
        let sub = hostname.slice(0, -suffix.length);
        if (sub.startsWith("api.")) {
          sub = sub.slice(4);
        }
        return sub.length > 0 ? sub : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Infer tenant slug from PostgREST base URL: pooled `api--{slug}--{hash}.<domain>`,
 * dedicated `api.{slug}.{hash}.<domain>`, or legacy hashless hosts.
 */
export function inferFluxTenantSlugFromPostgrestUrl(baseUrl: string): string | null {
  const sub = extractFluxTenantHostSubdomain(baseUrl);
  if (sub === null) return null;
  const flat = tryParseFlatApiTenantLabel(sub);
  if (flat) return flat.slug;
  const segs = sub.split(".");
  if (segs.length >= 2) {
    const last = segs[segs.length - 1] ?? "";
    if (/^[a-f0-9]{7}$/i.test(last)) {
      return segs.slice(0, -1).join(".") || null;
    }
  }
  return sub.length > 0 ? sub : null;
}

/**
 * Infer the per-project 7-hex tenant hash from a PostgREST base URL shaped like
 * `api--{slug}--{7hex}.<domain>` (pooled) or `api.{slug}.{7hex}.<domain>` (dedicated).
 * Returns `null` for legacy hashless URLs so callers can skip the activity bump safely.
 */
export function inferFluxTenantHashFromPostgrestUrl(baseUrl: string): string | null {
  const sub = extractFluxTenantHostSubdomain(baseUrl);
  if (sub === null) return null;
  const flat = tryParseFlatApiTenantLabel(sub);
  if (flat) return flat.hash;
  const segs = sub.split(".");
  if (segs.length < 2) return null;
  const last = segs[segs.length - 1] ?? "";
  return /^[a-f0-9]{7}$/i.test(last) ? last.toLowerCase() : null;
}

export function createClient(url: string, anonKey?: string): FluxClient;
export function createClient(options: FluxClientOptions): FluxClient;
export function createClient(
  urlOrOptions: string | FluxClientOptions,
  anonKey?: string,
): FluxClient {
  if (typeof urlOrOptions === "string") {
    return anonKey === undefined
      ? new FluxClient({ url: urlOrOptions })
      : new FluxClient({ url: urlOrOptions, anonKey });
  }
  return new FluxClient(urlOrOptions);
}

export class FluxClient {
  constructor(private readonly options: FluxClientOptions) {}

  from<Row = unknown>(tableName: string): QueryBuilder<Row> {
    return new QueryBuilder<Row>(this.options, tableName);
  }
}

type QueryMode = "select" | "insert" | "update" | "delete";

class QueryBuilder<Row = unknown> implements PromiseLike<FluxResult<Row | Row[]>> {
  private mode: QueryMode = "select";
  private columns = "*";
  private body: unknown;
  private readonly filters = new URLSearchParams();

  constructor(
    private readonly options: FluxClientOptions,
    private readonly tableName: string,
  ) {}

  select(columns = "*"): this {
    this.mode = "select";
    this.columns = columns;
    return this;
  }

  insert(data: Row | Row[]): this {
    this.mode = "insert";
    this.body = data;
    return this;
  }

  update(data: Partial<Row>): this {
    this.mode = "update";
    this.body = data;
    return this;
  }

  delete(): this {
    this.mode = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.set(column, `eq.${formatFilterValue(value)}`);
    return this;
  }

  then<TResult1 = FluxResult<Row | Row[]>, TResult2 = never>(
    onfulfilled?:
      | ((value: FluxResult<Row | Row[]>) => TResult1 | PromiseLike<TResult1>)
      | null
      | undefined,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private touchActivityAfterSuccess(): void {
    const act = this.options.activity;
    if (!act) return;
    const slug =
      act.slug?.trim() || inferFluxTenantSlugFromPostgrestUrl(this.options.url);
    if (!slug) return;
    const hash =
      act.hash?.trim() || inferFluxTenantHashFromPostgrestUrl(this.options.url);
    // Dashboard requires `?hash=<7hex>` to disambiguate (slug is only unique per user).
    // Skip the bump rather than risk updating the wrong row on legacy hashless URLs.
    if (!hash) return;
    const base = act.controlPlaneUrl.replace(/\/$/, "");
    const url =
      `${base}/api/projects/${encodeURIComponent(slug)}/activity` +
      `?hash=${encodeURIComponent(hash)}`;
    void fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${act.secret}` },
    }).catch(() => {
      /* ignore — best-effort bump */
    });
  }

  private async execute(): Promise<FluxResult<Row | Row[]>> {
    const base = this.options.url.replace(/\/$/, "");
    const url = new URL(`${base}/${encodeURIComponent(this.tableName)}`);
    for (const [key, value] of this.filters) {
      url.searchParams.set(key, value);
    }

    const headers = new Headers();
    headers.set("Accept", "application/json");
    if (this.options.anonKey) {
      headers.set("apikey", this.options.anonKey);
      headers.set("Authorization", `Bearer ${this.options.anonKey}`);
    }

    let method = "GET";
    let body: string | undefined;

    if (this.mode === "select") {
      url.searchParams.set("select", this.columns);
      method = "GET";
    } else if (this.mode === "insert") {
      method = "POST";
      headers.set("Content-Type", "application/json");
      headers.set("Prefer", "return=representation");
      body = JSON.stringify(this.body);
    } else if (this.mode === "update") {
      method = "PATCH";
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(this.body);
    } else {
      method = "DELETE";
    }

    const init: RequestInit =
      body === undefined ? { method, headers } : { method, headers, body };

    try {
      const res = await fetch(url, init);
      const payload = await parseJsonBody(res);

      if (!res.ok) {
        return { data: null, error: payload ?? res.statusText };
      }

      this.touchActivityAfterSuccess();
      return { data: payload as Row | Row[], error: null };
    } catch (e) {
      return { data: null, error: e };
    }
  }
}

function formatFilterValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return JSON.stringify(value);
}

async function parseJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
