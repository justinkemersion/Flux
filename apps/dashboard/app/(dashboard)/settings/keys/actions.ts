"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/src/lib/auth";
import {
  FLUX_CLI_KEY_PREFIX,
  generateFluxCliKey,
  hashFluxCliKeySecret,
} from "@/src/lib/cli-api-auth";
import { apiKeys } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";

export type CreatedKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: null;
  revokedAt: null;
};

export type CreateApiKeyResult =
  | { ok: true; plaintext: string; row: CreatedKeyRow }
  | { ok: false; error: string };

export async function createApiKeyAction(
  formData: FormData,
): Promise<CreateApiKeyResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Not signed in." };
  }

  const rawName = formData.get("name");
  const name =
    typeof rawName === "string" && rawName.trim().length > 0
      ? rawName.trim().slice(0, 128)
      : "Default Key";

  await initSystemDb();
  const db = getDb();
  const plaintext = generateFluxCliKey();
  const keyHash = hashFluxCliKeySecret(plaintext);

  try {
    const [row] = await db
      .insert(apiKeys)
      .values({
        userId: session.user.id,
        name,
        keyPrefix: FLUX_CLI_KEY_PREFIX,
        keyHash,
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        createdAt: apiKeys.createdAt,
      });

    revalidatePath("/settings/keys");

    const rowOut: CreatedKeyRow = {
      id: row.id,
      name: row.name,
      keyPrefix: row.keyPrefix,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    };
    return { ok: true, plaintext, row: rowOut };
  } catch {
    return { ok: false, error: "Could not create key. Try again." };
  }
}
