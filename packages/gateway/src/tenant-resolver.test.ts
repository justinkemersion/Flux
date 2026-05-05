import test from "node:test";
import assert from "node:assert/strict";
import { parseFluxSubdomain } from "./tenant-subdomain-parse.ts";

const base = "vsl-base.com";

test("parseFluxSubdomain: flat v2-style host (bloom-atelier)", () => {
  assert.deepEqual(
    parseFluxSubdomain("api--bloom-atelier--61d9dff.vsl-base.com", base),
    { kind: "flat", slug: "bloom-atelier", hash: "61d9dff" },
  );
});

test("parseFluxSubdomain: flat v2-style host (yeastcoast)", () => {
  assert.deepEqual(
    parseFluxSubdomain("api--yeastcoast--ffca33f.vsl-base.com", base),
    { kind: "flat", slug: "yeastcoast", hash: "ffca33f" },
  );
});

test("parseFluxSubdomain: flat host preserves slug segments with double dashes", () => {
  assert.deepEqual(
    parseFluxSubdomain("api--my--cool--slug--abcdef0.vsl-base.com", base),
    { kind: "flat", slug: "my--cool--slug", hash: "abcdef0" },
  );
});

test("parseFluxSubdomain: dotted legacy Traefik v1 host", () => {
  assert.deepEqual(
    parseFluxSubdomain("api.yeastcoast.ffca33f.vsl-base.com", base),
    { kind: "dotted", slug: "yeastcoast", hash: "ffca33f" },
  );
});

test("parseFluxSubdomain: legacy single-label slug-hash", () => {
  assert.deepEqual(
    parseFluxSubdomain("myapp-a1b2c3d.vsl-base.com", base),
    { kind: "legacySlugHash", slug: "myapp", hash: "a1b2c3d" },
  );
});

test("parseFluxSubdomain: bare apex domain", () => {
  assert.equal(parseFluxSubdomain("vsl-base.com", base), null);
});

test("parseFluxSubdomain: unrelated host", () => {
  assert.equal(parseFluxSubdomain("www.example.com", base), null);
});

test("parseFluxSubdomain: api-- label without slug/hash tail returns null", () => {
  assert.equal(parseFluxSubdomain("api--.vsl-base.com", base), null);
});

test("parseFluxSubdomain: dotted host with non-hex hash", () => {
  assert.equal(
    parseFluxSubdomain("api.my-slug.notahex.vsl-base.com", base),
    null,
  );
});

test("parseFluxSubdomain: normalises host casing", () => {
  assert.deepEqual(
    parseFluxSubdomain("API--YeastCoast--FFCA33F.VSL-BASE.COM", "VSL-BASE.COM"),
    { kind: "flat", slug: "yeastcoast", hash: "ffca33f" },
  );
});
