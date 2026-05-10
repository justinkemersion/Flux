import type { ApiClientContext } from "./context";

export async function streamContainerLogs(
  ctx: ApiClientContext,
  input: {
    slug: string;
    hash: string;
    service: "api" | "db";
  },
  onEvent: (ev: { line?: string; error?: string }) => void,
  init?: { signal?: AbortSignal },
): Promise<void> {
  const token = ctx.tokenOrThrow();
  const u = new URL(`${ctx.baseUrl}/cli/v1/logs`);
  u.searchParams.set("slug", input.slug.trim());
  u.searchParams.set("hash", input.hash.trim().toLowerCase());
  u.searchParams.set("service", input.service);
  const res = await fetch(u, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    },
    ...(init?.signal ? { signal: init.signal } : {}),
  });
  if (res.status === 401) {
    throw new Error("Invalid or expired API token. Run `flux login`.");
  }
  if (!res.ok) {
    const t = await res.text();
    let msg = `Request failed (${String(res.status)})`;
    try {
      const j = JSON.parse(t) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      if (t.trim()) msg = t.slice(0, 500);
    }
    throw new Error(msg);
  }
  if (!res.body) {
    throw new Error("CLI logs: empty response body.");
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let carry = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += dec.decode(value, { stream: true });
    const blocks = carry.split("\n\n");
    carry = blocks.pop() ?? "";
    for (const b of blocks) {
      for (const line of b.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const json = line.replace(/^data:\s*/, "").trim();
        if (!json) continue;
        let obj: { line?: string; error?: string };
        try {
          obj = JSON.parse(json) as { line?: string; error?: string };
        } catch {
          continue;
        }
        onEvent(obj);
        if (obj.error) {
          throw new Error(obj.error);
        }
      }
    }
  }
}
