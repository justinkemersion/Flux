import test from "node:test";
import assert from "node:assert/strict";
import {
  listOffsiteEnvKeysForDiagnostics,
  parseOffsiteStorageConfig,
} from "./config.js";

test("parseOffsiteStorageConfig returns null when disabled", () => {
  assert.equal(
    parseOffsiteStorageConfig({
      FLUX_R2_BACKUPS_ENABLED: "false",
      FLUX_R2_BACKUP_BUCKET: "b",
      FLUX_R2_BACKUP_PREFIX: "p",
      FLUX_R2_ENDPOINT: "https://example.com",
      FLUX_R2_ACCESS_KEY_ID: "ak",
      FLUX_R2_SECRET_ACCESS_KEY: "sk",
    }),
    null,
  );
});

test("parseOffsiteStorageConfig returns null when credentials missing", () => {
  assert.equal(
    parseOffsiteStorageConfig({
      FLUX_R2_BACKUPS_ENABLED: "true",
      FLUX_R2_BACKUP_BUCKET: "b",
      FLUX_R2_BACKUP_PREFIX: "p",
      FLUX_R2_ENDPOINT: "https://example.com",
    }),
    null,
  );
});

test("parseOffsiteStorageConfig parses enabled config", () => {
  const cfg = parseOffsiteStorageConfig({
    FLUX_R2_BACKUPS_ENABLED: "true",
    FLUX_R2_BACKUPS_STRICT: "1",
    FLUX_R2_BACKUP_BUCKET: "vsl-base-flux-backups",
    FLUX_R2_BACKUP_PREFIX: "prod",
    FLUX_R2_ENDPOINT: "https://account.r2.cloudflarestorage.com",
    FLUX_R2_REGION: "auto",
    FLUX_R2_ACCESS_KEY_ID: "test-access",
    FLUX_R2_SECRET_ACCESS_KEY: "test-secret",
  });
  assert.ok(cfg);
  assert.equal(cfg!.bucket, "vsl-base-flux-backups");
  assert.equal(cfg!.prefix, "prod");
  assert.equal(cfg!.strict, true);
  assert.equal(cfg!.region, "auto");
});

test("listOffsiteEnvKeysForDiagnostics redacts sensitive names", () => {
  const keys = listOffsiteEnvKeysForDiagnostics({
    FLUX_R2_BACKUPS_ENABLED: "true",
    FLUX_R2_ACCESS_KEY_ID: "secret-value",
    FLUX_R2_SECRET_ACCESS_KEY: "secret-value",
    FLUX_R2_BACKUP_BUCKET: "bucket",
  });
  assert.ok(keys.includes("FLUX_R2_BACKUPS_ENABLED"));
  assert.ok(keys.includes("FLUX_R2_BACKUP_BUCKET"));
  assert.ok(keys.some((k) => k.startsWith("FLUX_R2_ACCESS_KEY_ID=")));
  assert.ok(keys.some((k) => k.startsWith("FLUX_R2_SECRET_ACCESS_KEY=")));
});
