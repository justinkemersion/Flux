import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/src/lib/auth";
import { apiKeys } from "@/src/db/schema";
import { getDb, initSystemDb } from "@/src/lib/db";
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

  const userSegment =
    session.user.githubLogin?.trim() ||
    session.user.id?.trim() ||
    "—";

  return (
    <div className="flex min-h-full flex-col bg-zinc-950 text-zinc-400">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center px-4 pb-10 pt-4 sm:px-8 sm:pt-6 lg:px-10">
        <nav
          className="mb-8 flex w-full max-w-2xl min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-zinc-800/90 pb-4 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500 sm:justify-start sm:text-left"
          aria-label="Breadcrumb"
        >
          <Link
            href="/projects"
            className="shrink-0 text-zinc-400 transition-colors hover:text-zinc-200"
          >
            PROJECTS
          </Link>
          <span className="text-zinc-700" aria-hidden>
            /
          </span>
          <span className="min-w-0 truncate text-zinc-500" title={userSegment}>
            USER_{userSegment}
          </span>
          <span className="text-zinc-700" aria-hidden>
            /
          </span>
          <span className="shrink-0 text-zinc-400">SETTINGS</span>
          <span className="text-zinc-700" aria-hidden>
            /
          </span>
          <span className="shrink-0 text-zinc-300">API_KEYS</span>
        </nav>
        <div className="w-full max-w-2xl">
          <KeysVault initialRows={initialRows} />
        </div>
      </div>
    </div>
  );
}
