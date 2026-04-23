"use server";

import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { apiKeys } from "@/src/db/schema";
import { auth } from "@/src/lib/auth";
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
