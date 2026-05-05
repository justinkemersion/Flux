import test from "node:test";
import assert from "node:assert/strict";
import {
  fluxApiUrlForCatalog,
  fluxApiUrlForSlug,
  fluxApiUrlForV2Shared,
  fluxTenantPostgrestHostname,
  fluxTenantV1LegacyDottedHostname,
  fluxTenantV2SharedHostname,
} from "./tenant-catalog-urls.ts";

test("fluxApiUrlForSlug returns flattened canonical URL", () => {
  const prev = process.env.FLUX_DOMAIN;
  process.env.FLUX_DOMAIN = "vsl-base.com";
  try {
    assert.equal(
      fluxApiUrlForSlug("yeastcoast", "ffca33f", true),
      "https://api--yeastcoast--ffca33f.vsl-base.com",
    );
  } finally {
    if (prev === undefined) delete process.env.FLUX_DOMAIN;
    else process.env.FLUX_DOMAIN = prev;
  }
});

test("fluxApiUrlForCatalog returns flattened URL for v1_dedicated and v2_shared", () => {
  const prev = process.env.FLUX_DOMAIN;
  process.env.FLUX_DOMAIN = "vsl-base.com";
  try {
    const flat = "https://api--yeastcoast--ffca33f.vsl-base.com";
    assert.equal(
      fluxApiUrlForCatalog("yeastcoast", "ffca33f", true, "v1_dedicated"),
      flat,
    );
    assert.equal(
      fluxApiUrlForCatalog("yeastcoast", "ffca33f", true, "v2_shared"),
      flat,
    );
    assert.equal(fluxApiUrlForV2Shared("yeastcoast", "ffca33f", true), flat);
  } finally {
    if (prev === undefined) delete process.env.FLUX_DOMAIN;
    else process.env.FLUX_DOMAIN = prev;
  }
});

test("fluxTenantV1LegacyDottedHostname returns dotted v1 host", () => {
  const prev = process.env.FLUX_DOMAIN;
  process.env.FLUX_DOMAIN = "vsl-base.com";
  try {
    assert.equal(
      fluxTenantV1LegacyDottedHostname("yeastcoast", "ffca33f"),
      "api.yeastcoast.ffca33f.vsl-base.com",
    );
  } finally {
    if (prev === undefined) delete process.env.FLUX_DOMAIN;
    else process.env.FLUX_DOMAIN = prev;
  }
});

test("deprecated fluxTenantPostgrestHostname matches legacy dotted host", () => {
  const prev = process.env.FLUX_DOMAIN;
  process.env.FLUX_DOMAIN = "vsl-base.com";
  try {
    assert.equal(
      fluxTenantPostgrestHostname("yeastcoast", "ffca33f"),
      fluxTenantV1LegacyDottedHostname("yeastcoast", "ffca33f"),
    );
  } finally {
    if (prev === undefined) delete process.env.FLUX_DOMAIN;
    else process.env.FLUX_DOMAIN = prev;
  }
});

test("FLUX_DOMAIN env override is honored for flat hostname", () => {
  const prev = process.env.FLUX_DOMAIN;
  process.env.FLUX_DOMAIN = "example.test";
  try {
    assert.equal(
      fluxTenantV2SharedHostname("acme", "abc1234"),
      "api--acme--abc1234.example.test",
    );
  } finally {
    if (prev === undefined) delete process.env.FLUX_DOMAIN;
    else process.env.FLUX_DOMAIN = prev;
  }
});

test("fluxApiUrlForSlug ignores deprecated hostnamePrefix parameter", () => {
  const prev = process.env.FLUX_DOMAIN;
  process.env.FLUX_DOMAIN = "vsl-base.com";
  try {
    assert.equal(
      fluxApiUrlForSlug("yeastcoast", "ffca33f", true, "ignored"),
      "https://api--yeastcoast--ffca33f.vsl-base.com",
    );
  } finally {
    if (prev === undefined) delete process.env.FLUX_DOMAIN;
    else process.env.FLUX_DOMAIN = prev;
  }
});
