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

class QueryBuilder<Row = unknown> implements PromiseLike<FluxResult<Row | Row[]>> {
  private columns = "*";

  constructor(
    private readonly options: FluxClientOptions,
    private readonly tableName: string,
  ) {}

  select(columns = "*"): this {
    this.columns = columns;
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
    url.searchParams.set("select", this.columns);

    const headers = new Headers();
    headers.set("Accept", "application/json");
    if (this.options.anonKey) {
      headers.set("apikey", this.options.anonKey);
      headers.set("Authorization", `Bearer ${this.options.anonKey}`);
    }

    try {
      const res = await fetch(url, { method: "GET", headers });
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

async function parseJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
