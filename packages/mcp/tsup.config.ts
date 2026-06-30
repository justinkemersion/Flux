import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  // CJS bundle so the published `flux-mcp` bin runs under plain `node` without an
  // adjacent ESM loader. The package stays `"type": "module"` for `src/`.
  format: ["cjs"],
  platform: "node",
  target: "node20",
  clean: true,
  sourcemap: true,
  dts: false,
  bundle: true,
  // Compile the workspace TypeScript sources (`@flux/cli/api-client`, `@flux/core/*`)
  // into the bundle. Everything else (`@modelcontextprotocol/sdk`, `zod`) resolves
  // from node_modules at runtime.
  noExternal: [/^@flux\//],
  // Shebang comes from src/index.ts; do not duplicate via tsup banner.
  outExtension: () => ({ js: ".cjs" }),
  esbuildOptions: (o) => {
    o.legalComments = "none";
  },
});
