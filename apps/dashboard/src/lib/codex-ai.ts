import { FLUX_CODEX_JSON } from "@/src/lib/flux-codex-static";
import { getFleetReliability, getNodeStats } from "@/src/lib/fleet-monitor";

const MODEL = "@cf/meta/llama-3-8b-instruct" as const;

/**
 * Streams Cloudflare Workers AI response chunks for Flux Codex queries.
 */
export async function* queryFluxAI(
  userQuery: string,
): AsyncGenerator<string, void, undefined> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !token) {
    throw new Error(
      "Cloudflare Workers AI is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.",
    );
  }

  const telemetrySection = await buildTelemetrySection();

  const systemPrompt = [
    "You are Flux Codex Diagnostics.",
    "Use only the provided Flux technical specification as source of truth.",
    "Functional Aesthetic: respond with short, surgical, technical answers.",
    "If a request is outside the provided spec, explicitly refuse and state the scope limit.",
    "Do not speculate on non-Flux infrastructure or external systems.",
    telemetrySection,
    "",
    "Flux Technical Spec JSON (canonical):",
    JSON.stringify(FLUX_CODEX_JSON, null, 2),
  ].join("\n");

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
        { role: "system", content: systemPrompt },
        { role: "user", content: userQuery },
      ],
      stream: true,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Cloudflare AI error ${String(res.status)}: ${body.slice(0, 800)}`,
    );
  }

  if (!res.body) {
    throw new Error("Empty response body from Cloudflare AI.");
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") && !contentType.includes("event-stream")) {
    const payload = (await res.json()) as {
      response?: string;
      result?: { response?: string };
    };
    const text = payload.response ?? payload.result?.response ?? "";
    if (text) {
      yield text;
    }
    return;
  }

  yield* parseWorkersAiSse(res.body);
}

async function buildTelemetrySection(): Promise<string> {
  try {
    const [node, reliability] = await Promise.all([
      getNodeStats(),
      getFleetReliability(),
    ]);

    const uptime =
      reliability.percent == null
        ? "n/a"
        : `${reliability.percent.toFixed(1)}%`;

    return [
      "",
      "CURRENT_FLEET_STATE",
      `CPU Load: ${node.cpuLoad.toFixed(2)}`,
      `RAM Usage: ${node.memoryUsage.toFixed(1)}%`,
      `Container Count: ${String(node.containerCount)}`,
      `24H Reliability: ${uptime}`,
      "You are aware of the current infrastructure status. Use these numbers if the user asks about health, load, or uptime.",
    ].join("\n");
  } catch {
    // Telemetry is best-effort; keep Codex available with static spec only.
    return "";
  }
}

async function* parseWorkersAiSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let previous = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      for (const line of event.split("\n")) {
        if (!line.startsWith("data: ")) {
          continue;
        }
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") {
          continue;
        }

        let parsed: { response?: string } | null = null;
        try {
          parsed = JSON.parse(raw) as { response?: string };
        } catch {
          continue;
        }

        if (parsed?.response === undefined) {
          continue;
        }
        const current = parsed.response;
        if (current.startsWith(previous)) {
          yield current.slice(previous.length);
        } else {
          yield current;
        }
        previous = current;
      }
    }
  }
}
