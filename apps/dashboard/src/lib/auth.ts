import { type NextAuthOptions, type DefaultSession } from "next-auth";
import GitHub from "next-auth/providers/github";
import { eq } from "drizzle-orm";
import { initSystemDb, getDb } from "./db";
import { users, accounts } from "./db/schema";

declare module "next-auth" {
  interface Session {
    user: { id?: string } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  providers: [
    GitHub({
      clientId: process.env.GITHUB_ID ?? "",
      clientSecret: process.env.GITHUB_SECRET ?? "",
    }),
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      // Only runs on sign-in: user and account are present
      if (user?.email && account) {
        await initSystemDb();
        const db = getDb();

        const [dbUser] = await db
          .insert(users)
          .values({
            name: user.name ?? null,
            email: user.email,
            image: user.image ?? null,
          })
          .onConflictDoUpdate({
            target: users.email,
            set: { name: user.name ?? null, image: user.image ?? null },
          })
          .returning({ id: users.id });

        token.id = dbUser.id;

        await db
          .insert(accounts)
          .values({
            provider: account.provider,
            providerAccountId: account.providerAccountId,
            userId: dbUser.id,
            type: account.type,
            accessToken:
              typeof account.access_token === "string"
                ? account.access_token
                : null,
            refreshToken:
              typeof account.refresh_token === "string"
                ? account.refresh_token
                : null,
            expiresAt:
              typeof account.expires_at === "number"
                ? account.expires_at
                : null,
            tokenType:
              typeof account.token_type === "string"
                ? account.token_type
                : null,
            scope:
              typeof account.scope === "string" ? account.scope : null,
            idToken:
              typeof account.id_token === "string" ? account.id_token : null,
          })
          .onConflictDoNothing();
      }

      return token;
    },

    async session({ session, token }) {
      if (token.id) {
        session.user.id = token.id;
      }
      return session;
    },
  },
};

// Re-export getDb so API routes don't need a second import path
export { initSystemDb, getDb } from "./db";
export { eq } from "drizzle-orm";
