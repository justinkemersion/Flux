import test from "node:test";
import assert from "node:assert/strict";
import { CliTimestamp, formatCliTimestampDisplay } from "./cli-timestamp";

const FIXED_NOW = Date.parse("2026-06-22T17:18:33.697Z");
const SAMPLE_ISO = "2026-06-20T17:18:33.697Z";

test("CliTimestamp.parse ISO string", () => {
  const ts = CliTimestamp.parse(SAMPLE_ISO);
  assert.ok(ts);
  assert.equal(ts!.iso, SAMPLE_ISO);
  assert.equal(ts!.unixMs, Date.parse(SAMPLE_ISO));
});

test("CliTimestamp.parse unix seconds (truncates sub-second precision)", () => {
  const sec = Math.floor(Date.parse(SAMPLE_ISO) / 1000);
  const ts = CliTimestamp.parse(sec);
  assert.ok(ts);
  assert.equal(ts!.unixMs, sec * 1000);
});

test("CliTimestamp.parse unix milliseconds", () => {
  const ms = Date.parse(SAMPLE_ISO);
  const ts = CliTimestamp.parse(ms);
  assert.ok(ts);
  assert.equal(ts!.unixMs, ms);
});

test("formatDisplay includes unix ms, iso, human, and relative", () => {
  const ts = CliTimestamp.parse(SAMPLE_ISO)!;
  const line = ts.formatDisplay(FIXED_NOW);
  assert.match(line, /^1781975913697 · 2026-06-20T17:18:33\.697Z · .+ UTC · .+/);
  assert.match(line, /days ago|day ago/);
});

test("formatCliTimestampDisplay returns dash for invalid input", () => {
  assert.equal(formatCliTimestampDisplay(""), "—");
  assert.equal(formatCliTimestampDisplay(null), "—");
});

test("formatCliTimestampDisplay is stable for fixed now", () => {
  const line = formatCliTimestampDisplay(SAMPLE_ISO, FIXED_NOW);
  assert.equal(
    line,
    `${String(Date.parse(SAMPLE_ISO))} · ${SAMPLE_ISO} · Jun 20, 2026, 5:18 PM UTC · 2 days ago`,
  );
});
