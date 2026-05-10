import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  errorMessageFromJsonBody,
  parseJsonResponseBody,
  throwIfNotOkDescribeFailed,
} from "./json-response";

describe("parseJsonResponseBody", () => {
  it("returns null for empty or whitespace body", () => {
    assert.equal(parseJsonResponseBody("", "bad"), null);
    assert.equal(parseJsonResponseBody("  \n", "bad"), null);
  });

  it("parses JSON object", () => {
    assert.deepEqual(parseJsonResponseBody('{"a":1}', "bad"), { a: 1 });
  });

  it("throws with notJsonMessage on invalid JSON", () => {
    assert.throws(
      () => parseJsonResponseBody("{", "not json"),
      /not json/,
    );
  });
});

describe("errorMessageFromJsonBody", () => {
  it("prefers string error field", () => {
    assert.equal(
      errorMessageFromJsonBody({ error: "nope" }, 400),
      "nope",
    );
  });

  it("falls back to status message", () => {
    assert.equal(
      errorMessageFromJsonBody(null, 500),
      "Request failed (500)",
    );
  });
});

describe("throwIfNotOkDescribeFailed", () => {
  it("does nothing when res.ok", () => {
    throwIfNotOkDescribeFailed(
      new Response(null, { status: 200 }),
      {},
      "",
    );
  });

  it("throws describeFailedApiResponse message when not ok", () => {
    assert.throws(
      () =>
        throwIfNotOkDescribeFailed(
          new Response(null, { status: 502 }),
          { error: "bad gateway" },
          "",
        ),
      /bad gateway/,
    );
  });
});
