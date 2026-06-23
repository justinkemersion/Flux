import "server-only";

import { resolveWorkersAiChatModel } from "@/src/lib/workers-ai-model";

export type WorkersAiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function isWorkersAiConfigured(): boolean {
  return Boolean(
    process.env.CLOUDFLARE_ACCOUNT_ID?.trim() &&
      process.env.CLOUDFLARE_API_TOKEN?.trim(),
  );
}

/**
 * Non-streaming Workers AI completion for project-understanding features.
 */
export async function runWorkersAiCompletion(
  messages: WorkersAiMessage[],
  options?: { maxTokens?: number },
): Promise<string> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !token) {
    throw new Error(
      "Cloudflare Workers AI is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.",
    );
  }

  const model = resolveWorkersAiChatModel();
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages,
      stream: false,
      max_tokens: options?.maxTokens ?? 2048,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Cloudflare AI error ${String(res.status)}: ${body.slice(0, 800)}`,
    );
  }

  const payload = (await res.json()) as {
    response?: string;
    result?: { response?: string };
  };
  const text = (payload.response ?? payload.result?.response ?? "").trim();
  if (!text) {
    throw new Error("Empty response from Cloudflare AI.");
  }
  return text;
}
