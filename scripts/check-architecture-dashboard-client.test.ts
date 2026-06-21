import test from "node:test";
import assert from "node:assert/strict";
import {
  DASHBOARD_CLIENT_SAFE_CORE_SUBPATHS,
  findDashboardClientCoreImportViolations,
} from "./check-architecture.ts";

test("client boundary rejects root @flux/core barrel", () => {
  const violations = findDashboardClientCoreImportViolations(
    "apps/dashboard/src/components/foo.tsx",
    `"use client";\nimport { ProjectManager } from "@flux/core";\n`,
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0] ?? "", /must not import root @flux\/core/);
});

test("client boundary rejects non-allowlisted subpaths", () => {
  const violations = findDashboardClientCoreImportViolations(
    "apps/dashboard/src/components/foo.tsx",
    `"use client";\nimport { normalizePushSql } from "@flux/core/sql-migrations";\n`,
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0] ?? "", /not allowlisted/);
});

test("client boundary allows browser-safe subpaths", () => {
  const violations = findDashboardClientCoreImportViolations(
    "apps/dashboard/src/components/foo.tsx",
    `"use client";\nimport { backupFreshnessTierLabel } from "@flux/core/backup-policy";\n`,
  );
  assert.deepEqual(violations, []);
});

test("project-db-access-copy is checked without use client", () => {
  const violations = findDashboardClientCoreImportViolations(
    "apps/dashboard/src/lib/project-db-access-copy.ts",
    `export { buildDashboardDatabaseGuiHints } from "@flux/core/database-access-gui";\n`,
  );
  assert.deepEqual(violations, []);
});

test("server-only dashboard files are not checked", () => {
  const violations = findDashboardClientCoreImportViolations(
    "apps/dashboard/src/lib/flux.ts",
    `import { ProjectManager } from "@flux/core";\n`,
  );
  assert.deepEqual(violations, []);
});

test("allowlist includes database-access-gui", () => {
  assert.ok(DASHBOARD_CLIENT_SAFE_CORE_SUBPATHS.has("database-access-gui"));
});
