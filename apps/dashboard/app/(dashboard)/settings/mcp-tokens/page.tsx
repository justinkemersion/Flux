import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { projects } from "@/src/db/schema";
import { auth } from "@/src/lib/auth";
import { getDb, initSystemDb } from "@/src/lib/db";
import { listMcpTokensForUser } from "@/src/lib/mcp-tokens";
import { mcpTokensSignInRedirectUrl } from "@/src/components/mcp-tokens/mcp-tokens-utils";
import { McpTokensVault } from "./mcp-tokens-vault";

export const runtime = "nodejs";

export default async function SettingsMcpTokensPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(mcpTokensSignInRedirectUrl());
  }

  await initSystemDb();
  const db = getDb();

  const listed = await listMcpTokensForUser(db, session.user.id);
  const initialTokens = listed.ok ? listed.tokens : [];

  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
    })
    .from(projects)
    .where(eq(projects.userId, session.user.id))
    .orderBy(desc(projects.createdAt));

  const userSegment =
    session.user.githubLogin?.trim() ||
    session.user.id?.trim() ||
    "—";

  return (
    <div className="flex min-h-full flex-col bg-zinc-950 text-zinc-400">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center px-4 pb-10 pt-4 sm:px-8 sm:pt-6 lg:px-10">
        <nav
          className="mb-8 flex w-full max-w-2xl min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-zinc-800/90 pb-4 text-center text-sm text-zinc-500 sm:justify-start sm:text-left"
          aria-label="Breadcrumb"
        >
          <Link
            href="/projects"
            className="shrink-0 text-zinc-300 transition-colors hover:text-zinc-100"
          >
            Projects
          </Link>
          <span className="text-zinc-700" aria-hidden>
            /
          </span>
          <span className="min-w-0 truncate text-zinc-500" title={userSegment}>
            {userSegment}
          </span>
          <span className="text-zinc-700" aria-hidden>
            /
          </span>
          <span className="shrink-0 text-zinc-400">Settings</span>
          <span className="text-zinc-700" aria-hidden>
            /
          </span>
          <span className="shrink-0 text-zinc-300">MCP Tokens</span>
        </nav>
        <div className="w-full max-w-2xl">
          <p className="mb-6 text-center text-sm text-zinc-600 sm:text-left">
            Also see{" "}
            <Link href="/settings/keys" className="text-zinc-400 underline-offset-2 hover:underline">
              API Keys
            </Link>{" "}
            for CLI tokens.
          </p>
          <McpTokensVault initialTokens={initialTokens} projects={projectRows} />
        </div>
      </div>
    </div>
  );
}
