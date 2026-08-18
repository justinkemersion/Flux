import { assertFluxApiSchemaIdentifier } from "./api-schema-strategy.ts";

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Rejects an exposed API schema containing a base/partitioned table whose RLS
 * configuration cannot be intentional app authorization: RLS is either off,
 * or it is on without any policies. Dedicated projects have no gateway auth
 * layer, so this assertion belongs in the same transaction as user SQL.
 */
export function buildAssertExposedApiSchemaHasRlsSql(schema: string): string {
  assertFluxApiSchemaIdentifier(schema);
  const schemaLit = sqlLiteral(schema);

  return `DO $flux_rls_guard$
DECLARE
  disabled_tables text;
  policyless_tables text;
BEGIN
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY c.relname)
    INTO disabled_tables
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = ${schemaLit}
    AND c.relkind IN ('r', 'p')
    AND NOT c.relrowsecurity;

  IF disabled_tables IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = format(
        'Refusing push: exposed API table(s) have row level security disabled: %s',
        disabled_tables
      ),
      HINT = 'Enable row level security and create explicit policies before pushing.';
  END IF;

  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY c.relname)
    INTO policyless_tables
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = ${schemaLit}
    AND c.relkind IN ('r', 'p')
    AND c.relrowsecurity
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid
    );

  IF policyless_tables IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = format(
        'Refusing push: exposed API table(s) have row level security enabled but no policies: %s',
        policyless_tables
      ),
      HINT = 'Create at least one explicit policy for each exposed table before pushing.';
  END IF;
END
$flux_rls_guard$;`;
}
