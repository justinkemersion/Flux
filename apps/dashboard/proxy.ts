import { auth } from "@/src/lib/auth";

export default auth;

export const config = {
  matcher: ["/projects/:path*"],
};
