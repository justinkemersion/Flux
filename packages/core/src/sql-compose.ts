/**
 * Flux SQL composition contract.
 *
 * Naming convention for SQL constants:
 * - `*_STATEMENT` — complete executable statement, includes trailing `;`
 * - `*_BODY` — partial fragment (column list, WHERE clause, etc.), no trailing `;`
 *
 * Legacy names like `FLUX_MIGRATIONS_TABLE_DDL` are `_STATEMENT`-class constants.
 * When embedding complete statements inside larger templates (especially PL/pgSQL
 * `DO $$` blocks), use {@link embedSqlStatement}. Never write `${…};` in templates.
 */

/** Normalize to a complete statement (exactly one trailing semicolon). */
export function sqlStatement(fragment: string): string {
  const trimmed = fragment.trim();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

/** Embed a complete statement inside a larger SQL template. Never adds a second terminator. */
export function embedSqlStatement(fragment: string): string {
  return sqlStatement(fragment);
}
