import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { probeBackupArtifactOnDisk } from "./backup-artifact-probe.ts";

test("missing file", async () => {
  const dir = path.join(tmpdir(), `flux-probe-${String(Date.now())}`);
  await mkdir(dir, { recursive: true });
  try {
    const r = await probeBackupArtifactOnDisk({
      localPath: path.join(dir, "nope.dump"),
      checksumSha256: null,
      sizeBytes: null,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.artifactError, /not found/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("empty file", async () => {
  const dir = path.join(tmpdir(), `flux-probe-${String(Date.now())}`);
  await mkdir(dir, { recursive: true });
  const p = path.join(dir, "empty.dump");
  try {
    await writeFile(p, "");
    const r = await probeBackupArtifactOnDisk({
      localPath: p,
      sizeBytes: 0,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.artifactError, /empty/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("checksum match", async () => {
  const dir = path.join(tmpdir(), `flux-probe-${String(Date.now())}`);
  await mkdir(dir, { recursive: true });
  const p = path.join(dir, "x.dump");
  try {
    const body = Buffer.from("hello flux backup probe");
    await writeFile(p, body);
    const hex = createHash("sha256").update(body).digest("hex");
    const r = await probeBackupArtifactOnDisk({
      localPath: p,
      checksumSha256: hex,
      sizeBytes: body.length,
    });
    assert.equal(r.ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("checksum mismatch", async () => {
  const dir = path.join(tmpdir(), `flux-probe-${String(Date.now())}`);
  await mkdir(dir, { recursive: true });
  const p = path.join(dir, "x.dump");
  try {
    await writeFile(p, "a");
    const r = await probeBackupArtifactOnDisk({
      localPath: p,
      checksumSha256: "0".repeat(64),
      sizeBytes: 1,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.artifactError, /checksum mismatch/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("size mismatch skips hashing", async () => {
  const dir = path.join(tmpdir(), `flux-probe-${String(Date.now())}`);
  await mkdir(dir, { recursive: true });
  const p = path.join(dir, "x.dump");
  try {
    await writeFile(p, "abc");
    const r = await probeBackupArtifactOnDisk({
      localPath: p,
      checksumSha256: null,
      sizeBytes: 99,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.artifactError, /size mismatch/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
