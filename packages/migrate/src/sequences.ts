/**
 * Compare sequence `last_value` for every sequence in the tenant schema between source and target.
 */

export type SequenceSnapshot = Map<string, string>;

export async function snapshotSequencesInSchema(
  query: (sql: string) => Promise<Record<string, unknown>[]>,
  schemaName: string,
): Promise<SequenceSnapshot> {
  const lit = schemaName.replace(/'/g, "''");
  const rows = await query(
    `
    SELECT sequencename::text AS name, last_value::text AS last
    FROM pg_sequences
    WHERE schemaname = '${lit}'
    ORDER BY sequencename
    `,
  );
  const m = new Map<string, string>();
  for (const r of rows) {
    const name = r.name;
    const last = r.last;
    if (typeof name === "string" && typeof last === "string") {
      m.set(name, last);
    }
  }
  return m;
}

export function assertSequenceSnapshotsMatch(
  source: SequenceSnapshot,
  target: SequenceSnapshot,
  schemaName: string,
): void {
  const srcKeys = new Set(source.keys());
  const tgtKeys = new Set(target.keys());
  for (const k of srcKeys) {
    if (!tgtKeys.has(k)) {
      throw new Error(
        `Sequence "${k}" exists in source schema ${schemaName} but not in target after restore.`,
      );
    }
  }
  for (const k of tgtKeys) {
    if (!srcKeys.has(k)) {
      throw new Error(
        `Sequence "${k}" exists in target schema ${schemaName} but not in source (unexpected).`,
      );
    }
  }
  for (const k of srcKeys) {
    const a = source.get(k);
    const b = target.get(k);
    if (a !== b) {
      throw new Error(
        `Sequence last_value mismatch for "${k}" in ${schemaName}: source ${a} vs target ${b}`,
      );
    }
  }
}
