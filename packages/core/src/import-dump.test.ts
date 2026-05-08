import test from "node:test";
import assert from "node:assert/strict";
import {
  preparePlainSqlDumpForFlux,
  sanitizePlainSqlDumpForPostgresMajor,
} from "./import-dump.ts";

test("sanitizePlainSqlDumpForPostgresMajor strips restrict meta for PG15 target", () => {
  const input = `\\restrict abc\nSET foo = 1;\n\\unrestrict\nSELECT 1;\n`;
  const out = sanitizePlainSqlDumpForPostgresMajor(input, 15);
  assert.ok(!out.includes("\\restrict"));
  assert.ok(!out.includes("\\unrestrict"));
  assert.match(out, /SET foo = 1/);
  assert.match(out, /SELECT 1/);
});

test("sanitizePlainSqlDumpForPostgresMajor keeps restrict lines for PG17 target", () => {
  const input = `\\restrict abc\nSELECT 1;\n`;
  const out = sanitizePlainSqlDumpForPostgresMajor(input, 17);
  assert.equal(out, input);
});

test("preparePlainSqlDumpForFlux applies restrict strip for older server", () => {
  const sql = `\\restrict x\nCREATE TABLE a (id int);\n\\unrestrict\n`;
  const prepared = preparePlainSqlDumpForFlux({ sql, serverMajor: 16 });
  assert.ok(!prepared.includes("\\restrict"));
  assert.ok(!prepared.includes("\\unrestrict"));
  assert.match(prepared, /CREATE TABLE a/);
});
