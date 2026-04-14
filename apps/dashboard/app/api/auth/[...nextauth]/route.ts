import NextAuth from "next-auth";
import { authOptions } from "@/src/lib/auth";

// next-auth v4 requires Node runtime — Docker/pg calls happen inside callbacks
export const runtime = "nodejs";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
