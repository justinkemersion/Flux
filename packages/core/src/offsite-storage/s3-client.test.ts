import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isMissingOffsiteObjectError, S3OffsiteClient } from "./s3-client.js";
import type { OffsiteStorageConfig } from "./config.js";

const baseConfig: OffsiteStorageConfig = {
  enabled: true,
  strict: false,
  bucket: "test-bucket",
  prefix: "prod",
  endpoint: "https://example.r2.cloudflarestorage.com",
  region: "auto",
  accessKeyId: "test-key",
  secretAccessKey: "test-secret",
};

test("S3OffsiteClient putObjectFromFile success", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "flux-offsite-"));
  const filePath = path.join(dir, "backup.dump");
  await writeFile(filePath, "pg-dump-bytes");
  let captured: unknown;
  const client = new S3OffsiteClient(baseConfig, {
    send: async (cmd) => {
      captured = cmd;
      return { ETag: '"abc123"' };
    },
  });
  const result = await client.putObjectFromFile(
    filePath,
    "prod/flux/v1/hash/backup-id.dump",
    "a".repeat(64),
  );
  assert.equal(result.provider, "r2");
  assert.equal(result.bucket, "test-bucket");
  assert.equal(result.etag, "abc123");
  assert.equal(result.sizeBytes, 13);
  assert.equal(result.offsiteKey, "prod/flux/v1/hash/backup-id.dump");
  assert.ok(captured);
  await rm(dir, { recursive: true, force: true });
});

test("S3OffsiteClient putObjectFromFile failure", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "flux-offsite-"));
  const filePath = path.join(dir, "backup.dump");
  await writeFile(filePath, "x");
  const client = new S3OffsiteClient(baseConfig, {
    send: async () => {
      throw new Error("AccessDenied: invalid secret key abcdefghijklmnop");
    },
  });
  await assert.rejects(
    () => client.putObjectFromFile(filePath, "key.dump"),
    /Offsite storage operation failed/,
  );
  await rm(dir, { recursive: true, force: true });
});

test("S3OffsiteClient deleteObject sends DeleteObject with expected key", async () => {
  let captured: { input?: { Bucket?: string; Key?: string } } | undefined;
  const client = new S3OffsiteClient(baseConfig, {
    send: async (cmd) => {
      captured = cmd as { input?: { Bucket?: string; Key?: string } };
      return {};
    },
  });
  await client.deleteObject("prod/flux/v1/abc1234/backup-id.dump");
  assert.equal(captured?.input?.Bucket, "test-bucket");
  assert.equal(captured?.input?.Key, "prod/flux/v1/abc1234/backup-id.dump");
});

test("S3OffsiteClient deleteObject treats missing object as success", async () => {
  const client = new S3OffsiteClient(baseConfig, {
    send: async () => {
      const err = new Error("The specified key does not exist.");
      err.name = "NoSuchKey";
      (err as { $metadata?: { httpStatusCode?: number } }).$metadata = {
        httpStatusCode: 404,
      };
      throw err;
    },
  });
  await client.deleteObject("prod/flux/v1/abc1234/already-gone.dump");
});

test("isMissingOffsiteObjectError recognizes 404 / NoSuchKey", () => {
  const named = new Error("missing");
  named.name = "NoSuchKey";
  assert.equal(isMissingOffsiteObjectError(named), true);
  const status = new Error("boom");
  (status as { $metadata?: { httpStatusCode?: number } }).$metadata = {
    httpStatusCode: 404,
  };
  assert.equal(isMissingOffsiteObjectError(status), true);
  assert.equal(isMissingOffsiteObjectError(new Error("AccessDenied")), false);
});

test("S3OffsiteClient deleteObject still throws non-missing failures", async () => {
  const client = new S3OffsiteClient(baseConfig, {
    send: async () => {
      throw new Error("AccessDenied: invalid secret key abcdefghijklmnop");
    },
  });
  await assert.rejects(
    () => client.deleteObject("prod/flux/v1/abc1234/backup-id.dump"),
    /Offsite storage operation failed/,
  );
});
