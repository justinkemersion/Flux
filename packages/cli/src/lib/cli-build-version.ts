/**
 * Pinned CLI version. Must match `packages/cli/package.json` and the server
 * `/api/install/cli/version` when published; `cli-build-version.test.ts` enforces the
 * package.json half. Bundles report the version injected at build time instead.
 */
export const CLI_VERSION = "2.0.1";
