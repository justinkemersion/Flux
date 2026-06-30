import { desc, eq } from "drizzle-orm";
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

  return <McpTokensVault initialTokens={initialTokens} projects={projectRows} />;
}
