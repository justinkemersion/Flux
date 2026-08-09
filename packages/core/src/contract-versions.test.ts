import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FLUX_GATEWAY_CONTRACT_VERSION,
  FLUX_POOLED_PUSH_ADAPTER_CONTRACT,
  FLUX_POOLED_PUSH_ADAPTER_INVARIANTS,
} from "./contract-versions.ts";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Digest of the adapter source at the time `FLUX_POOLED_PUSH_ADAPTER_CONTRACT` was last set.
 *
 * The contract identifier is what a CLI checks before a pooled production migration, so it is
 * only trustworthy if it cannot silently fall behind the implementation. Editing the adapter
 * fails this test until the contract is bumped and this digest is updated in the same change.
 */
const ADAPTER_SOURCE_DIGEST =
  "6351bce26face0ff3e08a2e41d39cf011b808166f5086ee2d11093932a451d40";

test("pooled-push adapter contract is pinned to the adapter source", () => {
  const source = readFileSync(
    resolve(here, "pooled-push-sql-adapt.ts"),
    "utf8",
  );
  const digest = createHash("sha256").update(source).digest("hex");
  assert.equal(
    digest,
    ADAPTER_SOURCE_DIGEST,
    [
      "pooled-push-sql-adapt.ts changed without a contract decision.",
      "",
      "The deployed control plane advertises FLUX_POOLED_PUSH_ADAPTER_CONTRACT and CLIs gate",
      "production pooled migrations on it. If this change alters adaptation behavior, bump",
      "FLUX_POOLED_PUSH_ADAPTER_CONTRACT in contract-versions.ts. Either way, update",
      `ADAPTER_SOURCE_DIGEST to ${digest} in the same commit.`,
    ].join("\n"),
  );
});

test("contract identifiers are stable semver-ish strings", () => {
  assert.equal(FLUX_GATEWAY_CONTRACT_VERSION, "1.0.0");
  assert.equal(FLUX_POOLED_PUSH_ADAPTER_CONTRACT, "2.0.0");
  assert.match(FLUX_POOLED_PUSH_ADAPTER_CONTRACT, /^\d+\.\d+\.\d+$/u);
});

test("adapter invariants describe the lexical contract", () => {
  assert.ok(FLUX_POOLED_PUSH_ADAPTER_INVARIANTS.length >= 4);
  const joined = FLUX_POOLED_PUSH_ADAPTER_INVARIANTS.join(" ").toLowerCase();
  assert.match(joined, /lexical scan/u);
  assert.match(joined, /dollar-quoted/u);
  assert.match(joined, /dynamic ddl/u);
});
