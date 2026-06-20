import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DB_TUNNEL_LOCAL_PORT } from "./local-port";

test("default local tunnel port is 15432", () => {
  assert.equal(DEFAULT_DB_TUNNEL_LOCAL_PORT, 15432);
});
