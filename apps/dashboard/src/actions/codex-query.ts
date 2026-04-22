"use server";

import { createStreamableValue } from "ai/rsc";
import { runCodexQueryStream } from "@/src/lib/codex-cloudflare";

/**
 * Cloudflare Workers AI (Llama 3 8B) with the static Codex JSON as system context.
 * Returns a streamable string for `readStreamableValue` on the client.
 */
export async function queryCodexAction(query: string) {
  const trimmed = query.trim();
  const stream = createStreamableValue("");

  if (!trimmed) {
    stream.update("Enter a non-empty question.");
    stream.done();
    return stream.value;
  }

  void (async () => {
    let acc = "";
    try {
      for await (const piece of runCodexQueryStream(trimmed)) {
        acc += piece;
        stream.update(acc);
      }
      stream.done();
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "Codex query failed.";
      stream.update(
        acc ? `${acc}\n\n[error] ${message}` : `[error] ${message}`,
      );
      stream.done();
    }
  })();

  return stream.value;
}
