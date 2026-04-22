import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  sourcemap: true,
  dts: true,
  treeshake: true,
  bundle: true,
  banner: { js: "#!/usr/bin/env node" },
  outExtension: () => ({ js: ".js" }),
  // Bundle workspace packages into the artifact; keep Commander et al. external (CJS `require` breaks in ESM bundle).
  noExternal: ["@flux/core/standalone", "@flux/sdk"],
  external: ["commander", "chalk", "ora", "zod"],
  esbuildOptions: (o) => {
    o.legalComments = "none";
  },
});
