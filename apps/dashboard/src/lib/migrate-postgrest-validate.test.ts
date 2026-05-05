import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { postgrestMigrateValidateMode } from "./migrate-postgrest-validate";

describe("postgrestMigrateValidateMode", () => {
  const prev = process.env.FLUX_MIGRATE_POSTGREST_VALIDATE;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.FLUX_MIGRATE_POSTGREST_VALIDATE;
    } else {
      process.env.FLUX_MIGRATE_POSTGREST_VALIDATE = prev;
    }
  });

  it("defaults to auto when unset", () => {
    delete process.env.FLUX_MIGRATE_POSTGREST_VALIDATE;
    assert.equal(postgrestMigrateValidateMode(), "auto");
  });

  it("parses off", () => {
    for (const v of ["off", "0", "false", "no", "OFF"]) {
      process.env.FLUX_MIGRATE_POSTGREST_VALIDATE = v;
      assert.equal(postgrestMigrateValidateMode(), "off");
    }
  });

  it("parses strict", () => {
    for (const v of ["strict", "1", "true", "on", "STRICT"]) {
      process.env.FLUX_MIGRATE_POSTGREST_VALIDATE = v;
      assert.equal(postgrestMigrateValidateMode(), "strict");
    }
  });
});
