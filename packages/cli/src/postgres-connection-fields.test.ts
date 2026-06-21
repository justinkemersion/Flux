import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePostgresConnectionFields,
  parsePostgresPasswordFromConnectionString,
  resolvePostgresCredentialField,
} from "./postgres-connection-fields";

const SAMPLE_URL =
  "postgresql://postgres:sec%2Fret%40pass@flux-ffca33f-yeastcoast-db:5432/postgres";

test("parsePostgresConnectionFields decodes user, password, host, and database", () => {
  const fields = parsePostgresConnectionFields(SAMPLE_URL);
  assert.equal(fields.user, "postgres");
  assert.equal(fields.password, "sec/ret@pass");
  assert.equal(fields.database, "postgres");
  assert.equal(fields.host, "flux-ffca33f-yeastcoast-db");
  assert.equal(fields.port, 5432);
  assert.equal(fields.url, SAMPLE_URL);
});

test("parsePostgresPasswordFromConnectionString returns decoded password", () => {
  assert.equal(
    parsePostgresPasswordFromConnectionString(SAMPLE_URL),
    "sec/ret@pass",
  );
});

test("resolvePostgresCredentialField postgres.password prints only the password value", () => {
  const fields = parsePostgresConnectionFields(SAMPLE_URL);
  assert.equal(resolvePostgresCredentialField(fields, "postgres.password"), "sec/ret@pass");
});

test("resolvePostgresCredentialField unsupported field lists supported fields", () => {
  const fields = parsePostgresConnectionFields(SAMPLE_URL);
  assert.throws(
    () => resolvePostgresCredentialField(fields, "postgres.secret"),
    /Unsupported credential field "postgres.secret"/,
  );
  assert.throws(
    () => resolvePostgresCredentialField(fields, "postgres.secret"),
    /postgres.user, postgres.password/,
  );
});
