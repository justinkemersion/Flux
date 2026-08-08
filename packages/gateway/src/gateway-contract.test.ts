import test from "node:test";
import assert from "node:assert/strict";
import {
  FLUX_GATEWAY_CONTRACT_VERSION,
  FLUX_GATEWAY_CONTRACT_INVARIANTS,
} from "./gateway-contract.ts";

test("gateway contract version is stable semver", () => {
  assert.equal(FLUX_GATEWAY_CONTRACT_VERSION, "1.0.0");
});

test("gateway contract invariants document fail-closed auth", () => {
  assert.ok(
    FLUX_GATEWAY_CONTRACT_INVARIANTS.some((line) =>
      /401|fail-closed|required/i.test(line),
    ),
  );
  assert.ok(
    FLUX_GATEWAY_CONTRACT_INVARIANTS.some((line) =>
      /t_<12hex>_role|tenant role/i.test(line),
    ),
  );
});
