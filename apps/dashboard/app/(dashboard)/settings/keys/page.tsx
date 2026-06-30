import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/src/lib/auth";
import { apiKeys } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
import { FleetHealthGrid } from "@/src/components/fleet/fleet-health-grid";
import { KeysVault, type KeyVaultRow } from "./keys-vault";

export const runtime = "nodejs";

export default async function SettingsKeysPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(
      `/api/auth/signin?callbackUrl=${encodeURIComponent("/settings/keys")}`,
    );
  }

  await initSystemDb();
  const db = getDb();
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, session.user.id))
    .orderBy(desc(apiKeys.createdAt));

  const initialRows: KeyVaultRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    keyPrefix: r.keyPrefix,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
  }));

  return (
    <>
      <KeysVault initialRows={initialRows} />
      <section className="mt-10 border-t border-zinc-800/80 pt-8" aria-labelledby="infra-heading">
        <h2 id="infra-heading" className="text-sm font-semibold text-zinc-200">
          Infrastructure
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Host and fleet health metrics for debugging and operational visibility.
        </p>
        <div className="mt-4">
          <FleetHealthGrid />
        </div>
      </section>
    </>
  );
}
