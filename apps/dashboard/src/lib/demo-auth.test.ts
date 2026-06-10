import assert from "node:assert/strict";
import { describe, test } from "node:test";

describe("demo-auth", () => {
  test("isDemoEnabled is false when env unset", async () => {
    const prev = {
      enabled: process.env.FLUX_DEMO_ENABLED,
      userId: process.env.FLUX_DEMO_USER_ID,
      key: process.env.FLUX_DEMO_INTERNAL_KEY,
    };
    delete process.env.FLUX_DEMO_ENABLED;
    delete process.env.FLUX_DEMO_USER_ID;
    delete process.env.FLUX_DEMO_INTERNAL_KEY;

    const { isDemoEnabled } = await import("./demo-auth.ts");
    assert.equal(isDemoEnabled(), false);

    if (prev.enabled !== undefined) process.env.FLUX_DEMO_ENABLED = prev.enabled;
    if (prev.userId !== undefined) process.env.FLUX_DEMO_USER_ID = prev.userId;
    if (prev.key !== undefined) process.env.FLUX_DEMO_INTERNAL_KEY = prev.key;
  });
});
