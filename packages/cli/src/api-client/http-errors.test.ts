import test from "node:test";
import assert from "node:assert/strict";
import {
  describeFailedApiResponse,
  messageFromApiErrorBody,
} from "./http-errors";

test("messageFromApiErrorBody prefers error, message, detail", () => {
  assert.equal(
    messageFromApiErrorBody({ error: "  boom  " }),
    "boom",
  );
  assert.equal(messageFromApiErrorBody({ message: "m" }), "m");
  assert.equal(messageFromApiErrorBody({ detail: "d" }), "d");
  assert.equal(
    messageFromApiErrorBody({ error: "e", message: "m" }),
    "e",
  );
});

test("describeFailedApiResponse uses JSON message when present", () => {
  assert.equal(
    describeFailedApiResponse(500, { error: "bad" }, "ignored raw"),
    "bad",
  );
});

test("describeFailedApiResponse truncates plain text bodies", () => {
  const long = "x".repeat(600);
  const msg = describeFailedApiResponse(502, null, long);
  assert.ok(msg.includes("502"));
  assert.ok(msg.length < long.length + 80);
  assert.ok(msg.endsWith("…") || msg.includes("…"));
});

test("describeFailedApiResponse ignores HTML-looking bodies", () => {
  assert.equal(
    describeFailedApiResponse(503, null, "<!DOCTYPE html><p>x</p>"),
    "Request failed (503)",
  );
});
