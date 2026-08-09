import type { NextConfig } from "next";

/**
 * Build provenance is inlined at compile time via Next's `env`, which webpack replaces
 * statically. That is deliberate: the deployed control plane decides pooled-push SQL
 * adaptation, so operators must be able to prove which commit is serving. Because the
 * expressions are substituted during `next build`, a runtime environment variable of the same
 * name cannot impersonate them. Unset at build time means empty, which classifies as unknown
 * and fails closed rather than guessing.
 */
const buildProvenanceEnv = {
  FLUX_BUILD_SOURCE_SHA: process.env.FLUX_BUILD_SOURCE_SHA ?? "",
  FLUX_BUILD_DIRTY: process.env.FLUX_BUILD_DIRTY ?? "",
  FLUX_BUILD_TIMESTAMP: process.env.FLUX_BUILD_TIMESTAMP ?? "",
};

const nextConfig: NextConfig = {
  output: "standalone",
  env: buildProvenanceEnv,
  async headers() {
    return [
      {
        // Session/auth APIs must never be edge-cached as HTML (SPA fallbacks) or JSON snapshots.
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-cache, no-store, must-revalidate, max-age=0",
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
