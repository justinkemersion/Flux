import { buildApiSchemaPrivilegesSql } from "@flux/core";
import { assertFluxApiSchemaIdentifier } from "@flux/core/api-schema-strategy";
import type { GauntletMode } from "./types";

function qSchema(schema: string): string {
  assertFluxApiSchemaIdentifier(schema);
  return `"${schema.replace(/"/g, '""')}"`;
}

/** Tiny but meaningful schema for gauntlet API + introspection checks. */
export function buildGauntletSchemaSql(
  apiSchema: string,
  mode: GauntletMode,
): string {
  const s = qSchema(apiSchema);
  const privileges =
    mode === "v2_shared"
      ? `GRANT USAGE ON SCHEMA ${s} TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${s} TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${s} TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT USAGE, SELECT ON SEQUENCES TO authenticated;`
      : buildApiSchemaPrivilegesSql(apiSchema);
  return `
CREATE TABLE IF NOT EXISTS ${s}.gauntlet_notes (
  id bigserial PRIMARY KEY,
  title text NOT NULL,
  body text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ${s}.gauntlet_events (
  id bigserial PRIMARY KEY,
  note_id bigint NOT NULL REFERENCES ${s}.gauntlet_notes(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ${s}.gauntlet_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${s}.gauntlet_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gauntlet_notes_authenticated ON ${s}.gauntlet_notes;
CREATE POLICY gauntlet_notes_authenticated ON ${s}.gauntlet_notes
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS gauntlet_events_authenticated ON ${s}.gauntlet_events;
CREATE POLICY gauntlet_events_authenticated ON ${s}.gauntlet_events
  TO authenticated USING (true) WITH CHECK (true);

${privileges}
`.trim();
}
