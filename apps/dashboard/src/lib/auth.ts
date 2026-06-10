import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { Adapter } from "next-auth/adapters";
import NextAuth from "next-auth";
import type { DefaultSession, NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import {
  accounts,
  authenticators,
  sessions,
  users,
  verificationTokens,
} from "../db/schema";

/**
 * @auth/core merges provider credentials from AUTH_{PROVIDER}_* first.
 * Mirror the legacy NextAuth / GitHub App env names so OAuth + JWT work reliably.
 */
if (typeof process !== "undefined") {
  process.env.AUTH_SECRET ||= process.env.NEXTAUTH_SECRET;
  process.env.AUTH_URL ||= process.env.NEXTAUTH_URL;
  process.env.AUTH_GITHUB_ID ||= process.env.GITHUB_ID;
  process.env.AUTH_GITHUB_SECRET ||= process.env.GITHUB_SECRET;
}

/** Some providers send `expires_at` as a float or string; Postgres `integer` rejects non-integers. */
function withCoercedAccountTimestamps(adapter: Adapter): Adapter {
  return {
    ...adapter,
    async linkAccount(data) {
      const next = { ...data } as typeof data;
      if (next.expires_at != null) {
        const n = Number(next.expires_at);
        next.expires_at = Number.isFinite(n) ? Math.trunc(n) : undefined;
      }
      await adapter.linkAccount!(next);
    },
  };
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      githubLogin?: string | null;
      isDemo?: boolean;
    } & DefaultSession["user"];
  }
}

function coreAuthConfig(): Omit<NextAuthConfig, "adapter"> {
  const secret =
    process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

  return {
    trustHost: true,
    // Verbose logs can include provider secrets; opt in with AUTH_DEBUG=1 only when needed.
    debug: process.env.AUTH_DEBUG === "1",
    secret,
    session: { strategy: "jwt" },
    providers: [
      GitHub({
        clientId: process.env.AUTH_GITHUB_ID ?? process.env.GITHUB_ID,
        clientSecret:
          process.env.AUTH_GITHUB_SECRET ?? process.env.GITHUB_SECRET,
      }),
      Credentials({
        id: "flux-demo",
        name: "Flux Demo",
        credentials: {
          key: { type: "password" },
        },
        async authorize(credentials) {
          const { isDemoEnabled, demoUserId } = await import("./demo-auth");
          if (!isDemoEnabled()) return null;
          const expected = process.env.FLUX_DEMO_INTERNAL_KEY?.trim();
          if (!expected || credentials?.key !== expected) return null;
          const userId = demoUserId();
          if (!userId) return null;

          const { initSystemDb, getDb } = await import("./db");
          const { eq } = await import("drizzle-orm");
          await initSystemDb();
          const db = getDb();
          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
          if (!user) return null;

          return {
            id: user.id,
            name: user.name ?? "Flux Demo",
            email: user.email ?? undefined,
          };
        },
      }),
    ],
    callbacks: {
      authorized({ auth, request }) {
        const p = request.nextUrl.pathname;
        if (p.startsWith("/projects") || p.startsWith("/settings")) {
          return !!auth?.user;
        }
        return true;
      },
      async jwt({ token, user, account, profile }) {
        if (user?.id) token.id = user.id;
        if (account?.provider === "flux-demo") {
          (token as { isDemo?: boolean }).isDemo = true;
        }
        if (
          account?.provider === "github" &&
          profile &&
          typeof profile === "object" &&
          "login" in profile
        ) {
          token.githubLogin = (profile as { login: string }).login;
        }
        return token;
      },
      async session({ session, token }) {
        const id = (token.id as string | undefined) ?? token.sub;
        if (id) session.user.id = id;
        if ((token as { isDemo?: boolean }).isDemo) session.user.isDemo = true;
        if (token.githubLogin != null) {
          session.user.githubLogin = token.githubLogin as string;
        }
        return session;
      },
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const core = coreAuthConfig();
  // Edge middleware cannot reach Docker; JWT session does not need the adapter there.
  if (process.env.NEXT_RUNTIME === "edge") {
    return core;
  }
  const { initSystemDb, getDb } = await import("./db");
  await initSystemDb();
  return {
    ...core,
    adapter: withCoercedAccountTimestamps(
      DrizzleAdapter(getDb(), {
        usersTable: users,
        accountsTable: accounts,
        sessionsTable: sessions,
        verificationTokensTable: verificationTokens,
        authenticatorsTable: authenticators,
      }),
    ),
  };
});
