// next-auth v4 middleware verifies the JWT session cookie at the edge
// without touching Docker or the system DB.
export { default } from "next-auth/middleware";

export const config = {
  matcher: ["/projects/:path*"],
};
