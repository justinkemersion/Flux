import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  // CJS so bundled Commander (CJS + require(node builtins)) works; ESM output hits esbuild’s
  // unsupported dynamic `require("events")` inside wrapped CJS. Package remains `"type":"module"`
  // for `src/`; the published runnable artifact is `dist/index.cjs`.
  format: ["cjs"],
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
  outExtension: () => ({ js: ".cjs" }),
  // Single-file bundle for `curl …/api/install/cli | node` — no adjacent node_modules.
  // Do not bundle `@flux/core` (root): it pulls dockerode / native addons. Use `@flux/core/standalone` only.
  noExternal: [
    "@flux/core/standalone",
    "@flux/sdk",
    "chalk",
    "commander",
    "open",
    "ora",
    "strip-ansi",
    "zod",
  ],
  external: [],
  esbuildOptions: (o) => {
    o.legalComments = "none";
  },
});
