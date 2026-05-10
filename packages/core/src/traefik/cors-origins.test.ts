import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAllowedOriginsList,
  serializeAllowedOriginsList,
} from "./traefik-labels.ts";

test("parseAllowedOriginsList trims, dedupes, drops empty", () => {
  const list = parseAllowedOriginsList(" https://a.com , , https://b.com , https://a.com ");
  assert.deepEqual(list, ["https://a.com", "https://b.com"]);
});

test("serializeAllowedOriginsList round-trips with parse", () => {
  const raw = "a,b,a";
  assert.equal(
    serializeAllowedOriginsList(parseAllowedOriginsList(raw)),
    "a,b",
  );
});
