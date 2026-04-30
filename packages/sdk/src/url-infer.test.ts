import test from "node:test";
import assert from "node:assert/strict";
import {
  inferFluxTenantHashFromPostgrestUrl,
  inferFluxTenantSlugFromPostgrestUrl,
} from "./index.ts";

test("infers slug and hash from flat api-- host (v2_shared)", () => {
  const u = "https://api--bloom-atelier--e14f92d.vsl-base.com";
  assert.equal(inferFluxTenantSlugFromPostgrestUrl(u), "bloom-atelier");
  assert.equal(inferFluxTenantHashFromPostgrestUrl(u), "e14f92d");
});

test("infers slug and hash from dotted api. host (v1_dedicated)", () => {
  const u = "https://api.bloom.e14f92d.vsl-base.com";
  assert.equal(inferFluxTenantSlugFromPostgrestUrl(u), "bloom");
  assert.equal(inferFluxTenantHashFromPostgrestUrl(u), "e14f92d");
});
