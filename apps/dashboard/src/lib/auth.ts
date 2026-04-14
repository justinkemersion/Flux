import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import type { DefaultSession, NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import {
  accounts,
  authenticators,
  sessions,
  users,
  verificationTokens,
} from "../db/schema";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

function coreAuthConfig(): Omit<NextAuthConfig, "adapter"> {
  return {
    trustHost: true,
    session: { strategy: "jwt" },
    providers: [
      GitHub({
        clientId: process.env.GITHUB_ID ?? process.env.AUTH_GITHUB_ID,
        clientSecret:
          process.env.GITHUB_SECRET ?? process.env.AUTH_GITHUB_SECRET,
      }),
    ],
    callbacks: {
      authorized({ auth, request }) {
        if (request.nextUrl.pathname.startsWith("/projects")) {
          return !!auth?.user;
        }
        return true;
      },
      async jwt({ token, user }) {
        if (user?.id) token.id = user.id;
        return token;
      },
      async session({ session, token }) {
        const id = (token.id as string | undefined) ?? token.sub;
        if (id) session.user.id = id;
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
    adapter: DrizzleAdapter(getDb(), {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
      authenticatorsTable: authenticators,
    }),
  };
});
