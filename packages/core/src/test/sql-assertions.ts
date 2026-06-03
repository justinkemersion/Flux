import assert from "node:assert/strict";

/** Rejects consecutive statement terminators that break PL/pgSQL (e.g. `);;`). */
export function assertNoDoubleStatementTerminator(sql: string): void {
  assert.doesNotMatch(sql, /\);[\s\n]*;/);
  assert.doesNotMatch(sql, /;;/);
}
