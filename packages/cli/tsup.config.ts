import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  sourcemap: true,
  dts: {
    compilerOptions: {
      // DTS worker injects deprecated `baseUrl`; TS 6 wants this here, not only in tsconfig, to avoid TS5101.
      ignoreDeprecations: "6.0",
    },
  },
  treeshake: true,
  bundle: true,
  // Shebang comes from src/index.ts; avoid duplicating tsup banner (breaks tsup parse).
  outExtension: () => ({ js: ".js" }),
  // Bundle workspace packages into the artifact; keep Commander et al. external (CJS `require` breaks in ESM bundle).
  noExternal: ["@flux/core/standalone", "@flux/sdk"],
  external: ["commander", "chalk", "ora", "zod"],
  esbuildOptions: (o) => {
    o.legalComments = "none";
  },
});
