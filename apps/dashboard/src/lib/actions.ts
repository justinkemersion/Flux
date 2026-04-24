"use server";

import { createStreamableValue } from "ai/rsc";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { apiKeys } from "@/src/db/schema";
import { auth } from "@/src/lib/auth";
import { acquireCodexInferenceSlot, extractClientIpFromHeaders } from "@/src/lib/ai-throttler";
import { CODEX_INFERENCE_QUOTA_EXCEEDED_MESSAGE } from "@/src/lib/codex-inference-messages";
import { queryFluxAI } from "@/src/lib/codex-ai";
import { CODEX_OFFLINE_TERMINAL_MESSAGE } from "@/src/lib/codex-offline-message";
import { getDb, initSystemDb } from "@/src/lib/db";

type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Soft-revoke an API key owned by the current user.
 */
export async function revokeApiKeyAction(id: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Not signed in." };
  }
  const keyId = id.trim();
  if (!keyId) {
    return { ok: false, error: "Missing key id." };
  }

  await initSystemDb();
  const db = getDb();
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, keyId),
        eq(apiKeys.userId, session.user.id),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id });

  if (rows.length === 0) {
    return { ok: false, error: "Key not found or already revoked." };
  }

  revalidatePath("/settings/keys");
  return { ok: true };
}

/**
 * Hard-delete a revoked API key owned by the current user.
 */
export async function deleteApiKeyAction(id: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Not signed in." };
  }
  const keyId = id.trim();
  if (!keyId) {
    return { ok: false, error: "Missing key id." };
  }

  await initSystemDb();
  const db = getDb();
  const rows = await db
    .delete(apiKeys)
    .where(
      and(
        eq(apiKeys.id, keyId),
        eq(apiKeys.userId, session.user.id),
        isNotNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id });

  if (rows.length === 0) {
    return { ok: false, error: "Key not found or not revoked yet." };
  }

  revalidatePath("/settings/keys");
  return { ok: true };
}

/**
 * Stream Flux Codex answers from Cloudflare Workers AI.
 */
export async function queryCodexAction(query: string) {
  const trimmed = query.trim();
  const stream = createStreamableValue("");

  if (!trimmed) {
    stream.update("Enter a non-empty question.");
    stream.done();
    return stream.value;
  }

  const h = await headers();
  const clientIp = extractClientIpFromHeaders(h);
  const session = await auth();
  const slot = await acquireCodexInferenceSlot({
    userId: session?.user?.id,
    clientIp,
    // Future: pass project / billing tier when flux-system exposes it (v2 squeeze per plan).
  });

  if (!slot.allowed) {
    stream.update(CODEX_INFERENCE_QUOTA_EXCEEDED_MESSAGE);
    stream.done();
    return stream.value;
  }

  void (async () => {
    let output = "";
    try {
      for await (const chunk of queryFluxAI(trimmed)) {
        output += chunk;
        stream.update(output);
      }
      stream.done();
    } catch (error) {
      console.error("[queryCodexAction] Workers AI / Codex stream failed:", error);
      stream.update(CODEX_OFFLINE_TERMINAL_MESSAGE);
      stream.done();
    }
  })();

  return stream.value;
}
