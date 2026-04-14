export type FluxClientOptions = {
  url: string;
  anonKey?: string;
};

export type FluxResult<T> = {
  data: T | null;
  error: unknown | null;
};

export function createClient(url: string, anonKey?: string): FluxClient {
  return anonKey === undefined ? new FluxClient({ url }) : new FluxClient({ url, anonKey });
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
