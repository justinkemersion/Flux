import { FLUX_CODEX_JSON } from "@/src/lib/flux-codex-static";

const MODEL = "@cf/meta/llama-3-8b-instruct" as const;

/**
 * Iterates over Workers AI text chunks. Uses the REST `stream: true` SSE body.
 */
export async function* runCodexQueryStream(
  userQuery: string,
): AsyncGenerator<string, void, undefined> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !token) {
    throw new Error(
      "Cloudflare Workers AI is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.",
    );
  }

  const system = `You are the **Flux Fleet Navigator** and the **Flux Codex** — a precise, authoritative guide to the Flux control plane, mesh, and CLI. The JSON below is canonical ground truth; prefer it over general Docker or Postgres knowledge. Answer in plain text that reads well in a monospace terminal. If something is not in the reference, say you do not have that information.

## Identity
- You help operators and developers with **per-tenant** stacks: isolated PostgreSQL + PostgREST, Docker-orchestrated, Traefik-routed.
- Distinguish **power** (STOP/START) from **destruction** (REPAIR, NUKE) and from **idle maintenance** (reap, when present).

## The Determinism rule
- **Slugs** are **user-chosen** (the project name is normalized to a URL-safe slug in the engine).
- **Hashes** are exactly **7** lowercase **hex** characters, **assigned by the orchestrator** at provision. Users do not set or change the hash. They appear in \`flux-{hash}-{slug}\` naming and on public hostnames/labels.

## The Password rule (deterministic dev / staging)
- The derived Postgres password is: **HMAC-SHA256** with **key** = the master server secret (\`FLUX_DEV_POSTGRES_PASSWORD\` or \`FLUX_PROJECT_PASSWORD_SECRET\`) and **message** = the exact **tenant data volume** name in UTF-8 (e.g. \`flux-{hash}-{slug}-db-data\`). Take the **hex** digest, **first 32 characters** — same as @flux/core \`deriveTenantPostgresPasswordFromSecret\`.
- If a caller describes HMAC as \`HMAC_SHA256(volume_name, master_secret)\`, they mean: volume name is the **HMAC input message**, master secret is the **key** (order of arguments does not follow Node’s \`createHmac(algorithm, key).update(message)\` literally).
- On any detail, the JSON \`deterministicPassword\` object below wins.

---
Canonical JSON (ground truth for all of the above):

${JSON.stringify(FLUX_CODEX_JSON, null, 2)}`;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(
    MODEL,
  )}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: system },
        { role: "user", content: userQuery },
      ],
      stream: true,
      max_tokens: 1024,
    }),
  });

  const ct = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    const t = await res.text();
    throw new Error(
      `Cloudflare AI error ${String(res.status)}: ${t.slice(0, 800)}`,
    );
  }

  if (ct.includes("application/json") && !ct.includes("event-stream")) {
    const j = (await res.json()) as { response?: string; result?: { response?: string } };
    const text =
      j.response ?? j.result?.response ?? JSON.stringify(j);
    if (text) yield text;
    return;
  }

  if (!res.body) {
    throw new Error("Empty response body from Cloudflare AI");
  }

  yield* parseWorkersAiSse(res.body);
}

async function* parseWorkersAiSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, undefined> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  let last = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const block of parts) {
      for (const line of block.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        let o: { response?: string } | null = null;
        try {
          o = JSON.parse(raw) as { response?: string };
        } catch {
          continue;
        }
        if (o?.response === undefined) continue;
        const full = o.response;
        if (full.startsWith(last)) {
          yield full.slice(last.length);
        } else {
          yield full;
        }
        last = full;
      }
    }
  }
}
