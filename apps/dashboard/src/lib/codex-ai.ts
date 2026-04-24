import { FLUX_CODEX_AI_PROMPT_JSON } from "@/src/lib/flux-codex-static";
import {
  type FleetReliability,
  getFleetReliability,
  getNodeStats,
} from "@/src/lib/fleet-monitor";

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
    "Functional Aesthetic: short, surgical, technical answers. No conversational filler (no 'Sure', 'I can help', or similar). Start with the answer.",
    "If a request is outside the provided spec, explicitly refuse and state the scope limit.",
    "Do not speculate on non-Flux infrastructure or external systems.",
    "Tiers and engines: Free and Pro use v2_shared (shared Postgres cluster, schema-per-tenant, pooled PostgREST, gateway-signed JWTs, PgBouncer transaction pooling). Enterprise uses v1_dedicated (one Postgres + one PostgREST container per project, full container isolation, for SOC2/HIPAA-style workloads). v1 and v2 coexist indefinitely. Do not invent billing limits or SLAs not stated here.",
    "CLI-first operations: when the user asks about an operation (exporting data, viewing logs, provisioning, schema push, lifecycle), you MUST lead with the specific CLI command. Use the form `flux <command> [args]`. Follow immediately with a brief fenced code block using real flags (e.g. --hash, --schema-only, --service) where applicable.",
    "REST is secondary: only after the CLI explanation, you may mention the underlying REST API path and query parameters as an alternative for advanced automation.",
    telemetrySection,
    "",
    "Flux Technical Spec JSON (canonical):",
    JSON.stringify(FLUX_CODEX_AI_PROMPT_JSON, null, 2),
  ].join("\n");

  // Workers AI model identifiers contain `/`; keep the raw segment in-path.
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`;

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

/** Docker `info` can hang when DOCKER_HOST is wrong or the daemon is wedged — never block Codex. */
const CODEX_TELEMETRY_BUDGET_MS = 2_500;

const FALLBACK_NODE_STATS = {
  containerCount: 0,
  memoryUsage: 0,
  cpuLoad: 0,
} as const;

const FALLBACK_FLEET_RELIABILITY: FleetReliability = {
  percent: null,
  successCount: 0,
  totalCount: 0,
  windowHours: 24,
};

async function buildTelemetrySection(): Promise<string> {
  try {
    const [node, reliability] = await Promise.all([
      withTimeout(getNodeStats(), CODEX_TELEMETRY_BUDGET_MS, FALLBACK_NODE_STATS, "getNodeStats"),
      withTimeout(
        getFleetReliability(),
        CODEX_TELEMETRY_BUDGET_MS,
        FALLBACK_FLEET_RELIABILITY,
        "getFleetReliability",
      ),
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

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        `[queryFluxAI] telemetry ${label} exceeded ${String(ms)}ms; using fallback for Codex prompt`,
      );
      resolve(fallback);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
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
